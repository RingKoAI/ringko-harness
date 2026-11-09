#include "platform.h"
#include <aclapi.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <winioctl.h>
#include <sddl.h>

static bool system_error(file_error *error, DWORD code = GetLastError()) {
  const char *name = code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND ? "ENOENT" :
    code == ERROR_FILE_EXISTS || code == ERROR_ALREADY_EXISTS ? "EEXIST" :
    code == ERROR_DISK_FULL ? "ENOSPC" : code == ERROR_SHARING_VIOLATION ? "EBUSY" :
    code == ERROR_ACCESS_DENIED ? "EACCES" : "EIO";
  return file_refuse(error, name, "Safe native file operation failed; retry if the target changed.");
}
static bool information(HANDLE handle, file_info *info, file_error *error, bool directory) {
  BY_HANDLE_FILE_INFORMATION value;
  if (!GetFileInformationByHandle(handle, &value)) return system_error(error);
  if (value.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) return file_refuse(error, "ELOOP", "File target changed to a link; retry the call.");
  if (((value.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != directory) return file_refuse(error, directory ? "ENOTDIR" : "ENOTREG", "A regular file target is required.");
  if (info) {
    info->exists = true;
    info->size = (static_cast<uint64_t>(value.nFileSizeHigh) << 32) | value.nFileSizeLow;
    const uint64_t ticks = (static_cast<uint64_t>(value.ftLastWriteTime.dwHighDateTime) << 32) | value.ftLastWriteTime.dwLowDateTime;
    const uint64_t epoch = UINT64_C(116444736000000000);
    info->mtime_ms = ticks >= epoch ? static_cast<double>(ticks - epoch) / 10000.0 : -static_cast<double>(epoch - ticks) / 10000.0;
    snprintf(info->identity, sizeof(info->identity), "win:%lu:%lu:%lu", static_cast<unsigned long>(value.dwVolumeSerialNumber), static_cast<unsigned long>(value.nFileIndexHigh), static_cast<unsigned long>(value.nFileIndexLow));
  }
  return true;
}
static HANDLE directory_handle(const wchar_t *path) {
  return CreateFileW(path, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, NULL);
}
bool file_begin(file_transaction *tx, file_char *path, enum file_kind kind, bool absent, file_error *error) {
  tx->path = path; tx->kind = kind; tx->source = tx->staged = INVALID_HANDLE_VALUE;
  const size_t length = wcslen(path);
  size_t drive = 0;
  if (length >= 4 && wcsncmp(path, L"\\\\?\\", 4) == 0) drive = 4;
  if (length < drive + 4 || path[drive + 1] != L':' || path[drive + 2] != L'\\') return file_refuse(error, "ENOTSUP", "Atomic Windows file operations require an absolute local-drive path.");
  for (size_t index = drive + 2; index < length; index++) if (path[index] == L':') return file_refuse(error, "ENOTSUP", "Atomic file operations do not support alternate data streams.");
  wchar_t *last = wcsrchr(path, L'\\');
  if (!last || !last[1]) return file_refuse(error, "EINVAL", "A regular file target is required.");
  const size_t parent_length = static_cast<size_t>(last - path);
  for (size_t start = drive + 3, end = start; end <= length; end++) {
    if (path[end] != L'\\' && path[end] != 0) continue;
    const size_t count = end - start;
    if ((count == 1 && path[start] == L'.') || (count == 2 && path[start] == L'.' && path[start + 1] == L'.')) return file_refuse(error, "EINVAL", "File targets must use canonical path components.");
    start = end + 1;
  }
  for (size_t index = drive + 2; index <= parent_length; index++) {
    if (path[index] != L'\\') continue;
    if (tx->directory_count >= FILE_MAX_DEPTH + 1) return file_refuse(error, "EINVAL", "File path exceeds the nesting limit.");
    // Include the drive root's trailing slash; other components end before it.
    const size_t end = index == drive + 2 ? index + 1 : index;
    wchar_t saved = path[end]; path[end] = 0;
    HANDLE handle = directory_handle(path);
    if (handle == INVALID_HANDLE_VALUE && (kind == FILE_WRITE || kind == FILE_STORAGE_LOCK)) {
      DWORD code = GetLastError();
      if (code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND) {
        if (!CreateDirectoryW(path, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) { path[end] = saved; return system_error(error); }
        handle = directory_handle(path);
      }
    }
    path[end] = saved;
    if (handle == INVALID_HANDLE_VALUE) return system_error(error);
    tx->directories[tx->directory_count++] = handle;
    if (!information(handle, NULL, error, true)) return false;
  }
  tx->source = CreateFileW(path, GENERIC_READ | (kind == FILE_REMOVE ? DELETE : 0), kind == FILE_STORAGE_LOCK ? 0 : FILE_SHARE_READ, NULL, kind == FILE_STORAGE_LOCK ? OPEN_ALWAYS : OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (tx->source == INVALID_HANDLE_VALUE) {
    DWORD code = GetLastError();
    if (code != ERROR_FILE_NOT_FOUND) return system_error(error, code);
    if (kind == FILE_EDIT) return file_refuse(error, "ENOENT", "Edit target was not found.");
  } else {
    tx->existed = true;
    if (!information(tx->source, &tx->original, error, false)) return false;
    BY_HANDLE_FILE_INFORMATION attributes;
    if (!GetFileInformationByHandle(tx->source, &attributes)) return system_error(error);
    tx->original_windows = attributes;
    if ((kind == FILE_WRITE || kind == FILE_EDIT) && (attributes.dwFileAttributes & FILE_ATTRIBUTE_READONLY)) return file_refuse(error, "EACCES", "File target is read-only.");
    if ((kind == FILE_WRITE || kind == FILE_EDIT) && (attributes.dwFileAttributes & FILE_ATTRIBUTE_ENCRYPTED)) return file_refuse(error, "ENOTSUP", "Atomic replacement of EFS-encrypted files requires an EFS-aware editor; the original file was not changed.");
    if (kind == FILE_STORAGE_LOCK && (tx->original.size != 0 || attributes.nNumberOfLinks != 1)) return file_refuse(error, "EINVAL", "Upload lock must be an empty, single-linked regular file.");
  }
  if (absent && tx->existed) return file_refuse(error, "EEXIST", "Write target appeared after approval; retry the call.");
  if (kind == FILE_EDIT && tx->original.size > FILE_MAX_BYTES) return file_refuse(error, "EFBIG", "Edit source exceeds the 64 MiB size limit.");
  return true;
}
bool file_read(file_transaction *tx, void *buffer, size_t length, size_t *count, file_error *error) {
  DWORD received = 0;
  if (!ReadFile(tx->source, buffer, static_cast<DWORD>(length), &received, NULL)) return system_error(error);
  tx->read_bytes += received;
  if (tx->read_bytes > FILE_MAX_BYTES) return file_refuse(error, "EFBIG", "Edit source exceeds the 64 MiB size limit.");
  *count = received; return true;
}
static bool copy_permissions(HANDLE source, HANDLE destination, file_error *error) {
  PACL dacl = NULL; PSID owner = NULL, group = NULL; PSECURITY_DESCRIPTOR descriptor = NULL;
  DWORD status = GetSecurityInfo(source, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION, &owner, &group, &dacl, NULL, &descriptor);
  if (status) return system_error(error, status);
  SECURITY_DESCRIPTOR_CONTROL control; DWORD revision;
  bool ok = true;
  if (!GetSecurityDescriptorControl(descriptor, &control, &revision)) ok = system_error(error);
  else {
    PSID current_owner = NULL, current_group = NULL; PSECURITY_DESCRIPTOR current = NULL;
    status = GetSecurityInfo(destination, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION, &current_owner, &current_group, NULL, NULL, &current);
    if (status) ok = system_error(error, status);
    else if (!EqualSid(owner, current_owner) || !EqualSid(group, current_group)) {
      HANDLE metadata = ReOpenFile(destination, WRITE_OWNER, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_FLAG_OPEN_REPARSE_POINT);
      if (metadata == INVALID_HANDLE_VALUE) ok = system_error(error);
      else {
        status = SetSecurityInfo(metadata, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION, owner, group, NULL, NULL);
        if (status) ok = system_error(error, status);
        if (!CloseHandle(metadata)) ok = system_error(error);
      }
    }
    if (current) LocalFree(current);
    const DWORD protection = control & SE_DACL_PROTECTED ? PROTECTED_DACL_SECURITY_INFORMATION : UNPROTECTED_DACL_SECURITY_INFORMATION;
    if (ok) { status = SetSecurityInfo(destination, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | protection, NULL, NULL, dacl, NULL); if (status) ok = system_error(error, status); }
  }
  LocalFree(descriptor); return ok;
}
static bool copy_integrity_label(HANDLE source, HANDLE destination, file_error *error) {
  PACL label = NULL, current = NULL; PSECURITY_DESCRIPTOR original = NULL, existing = NULL, fallback = NULL;
  DWORD status = GetSecurityInfo(source, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, NULL, NULL, NULL, &label, &original);
  if (status) return system_error(error, status);
  status = GetSecurityInfo(destination, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, NULL, NULL, NULL, &current, &existing);
  bool ok = status == ERROR_SUCCESS;
  if (!ok) system_error(error, status);
  else if ((label || current) && (!label || !current || label->AclSize != current->AclSize || memcmp(label, current, label->AclSize))) {
    // A missing object label has the Windows default medium-integrity policy.
    if (!label) {
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(L"S:(ML;;NW;;;ME)", SDDL_REVISION_1, &fallback, NULL)) ok = system_error(error);
      else { BOOL present, defaulted; if (!GetSecurityDescriptorSacl(fallback, &present, &label, &defaulted) || !present) ok = system_error(error); }
    }
    if (ok) {
      HANDLE metadata = ReOpenFile(destination, WRITE_OWNER, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_FLAG_OPEN_REPARSE_POINT);
      if (metadata == INVALID_HANDLE_VALUE) ok = system_error(error);
      else { status = SetSecurityInfo(metadata, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, NULL, NULL, NULL, label); if (status) ok = system_error(error, status); if (!CloseHandle(metadata)) ok = system_error(error); }
    }
  }
  if (fallback) LocalFree(fallback);
  if (existing) LocalFree(existing);
  LocalFree(original); return ok;
}
static bool copy_attributes(file_transaction *tx, file_error *error) {
  const DWORD attributes = tx->original_windows.dwFileAttributes;
  if (attributes & FILE_ATTRIBUTE_COMPRESSED) {
    USHORT format = 0; DWORD received = 0;
    if (!DeviceIoControl(tx->source, FSCTL_GET_COMPRESSION, NULL, 0, &format, sizeof(format), &received, NULL) || received != sizeof(format)) return system_error(error);
    if (!DeviceIoControl(tx->staged, FSCTL_SET_COMPRESSION, &format, sizeof(format), NULL, 0, &received, NULL)) return system_error(error);
  }
  if (attributes & FILE_ATTRIBUTE_SPARSE_FILE) { DWORD received = 0; if (!DeviceIoControl(tx->staged, FSCTL_SET_SPARSE, NULL, 0, NULL, 0, &received, NULL)) return system_error(error); }
  FILE_BASIC_INFO basic = {};
  basic.FileAttributes = attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED | FILE_ATTRIBUTE_TEMPORARY);
  if (!basic.FileAttributes) basic.FileAttributes = FILE_ATTRIBUTE_NORMAL;
  if (!SetFileInformationByHandle(tx->staged, FileBasicInfo, &basic, sizeof(basic))) return system_error(error);
  return SetFileTime(tx->staged, &tx->original_windows.ftCreationTime, NULL, NULL) ? true : system_error(error);
}
bool file_stage(file_transaction *tx, const char *name, file_error *error) {
  const wchar_t *last = wcsrchr(tx->path, L'\\');
  const size_t parent = static_cast<size_t>(last - tx->path) + 1, length = strlen(name);
  wchar_t *temporary = static_cast<wchar_t *>(calloc(parent + length + 1, sizeof(wchar_t)));
  if (!temporary) return file_refuse(error, "ENOMEM", "Could not allocate a temporary path.");
  memcpy(temporary, tx->path, parent * sizeof(wchar_t));
  for (size_t index = 0; index < length; index++) temporary[parent + index] = static_cast<unsigned char>(name[index]);
  tx->staged = CreateFileW(temporary, GENERIC_READ | GENERIC_WRITE | DELETE | WRITE_DAC, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  const DWORD code = tx->staged == INVALID_HANDLE_VALUE ? GetLastError() : ERROR_SUCCESS;
  free(temporary);
  if (tx->staged == INVALID_HANDLE_VALUE) return system_error(error, code);
  tx->staged_ready = true;
  return !tx->existed || (copy_integrity_label(tx->source, tx->staged, error) && copy_permissions(tx->source, tx->staged, error) && copy_attributes(tx, error));
}
bool file_write(file_transaction *tx, const void *data, size_t length, file_error *error) {
  size_t position = 0;
  while (position < length) {
    DWORD written;
    if (!WriteFile(tx->staged, static_cast<const char *>(data) + position, static_cast<DWORD>(length - position), &written, NULL)) return system_error(error);
    if (!written) return file_refuse(error, "EIO", "File write made no progress.");
    position += written;
  }
  tx->written += length; tx->flushed = false; return true;
}
bool file_flush(file_transaction *tx, file_error *error) { if (!FlushFileBuffers(tx->staged)) return system_error(error); tx->flushed = true; return true; }
bool file_commit(file_transaction *tx, file_info *result, file_error *error) {
  const size_t bytes = wcslen(tx->path) * sizeof(wchar_t), offset = offsetof(FILE_RENAME_INFO, FileName);
  FILE_RENAME_INFO *rename = static_cast<FILE_RENAME_INFO *>(calloc(1, offset + bytes + sizeof(wchar_t)));
  if (!rename) return file_refuse(error, "ENOMEM", "Could not allocate atomic rename metadata.");
  rename->ReplaceIfExists = tx->existed ? TRUE : FALSE;
  rename->FileNameLength = static_cast<DWORD>(bytes);
  memcpy(rename->FileName, tx->path, bytes);
  if (tx->source != INVALID_HANDLE_VALUE) { CloseHandle(tx->source); tx->source = INVALID_HANDLE_VALUE; }
  bool ok = SetFileInformationByHandle(tx->staged, FileRenameInfo, rename, static_cast<DWORD>(offset + bytes + sizeof(wchar_t))) != 0;
  const DWORD code = ok ? ERROR_SUCCESS : GetLastError();
  free(rename);
  if (!ok) return system_error(error, code);
  tx->committed = true;
  if (!information(tx->staged, result, error, false)) return false;
  tx->result = *result; return true;
}
bool file_remove(file_transaction *tx, const char *identity, file_error *error) {
  if (!tx->existed) return true;
  if (strcmp(tx->original.identity, identity)) return file_refuse(error, "ESTALE", "Cleanup target identity changed; refusing removal.");
  FILE_DISPOSITION_INFO disposition = { TRUE };
  if (!SetFileInformationByHandle(tx->source, FileDispositionInfo, &disposition, sizeof(disposition))) return system_error(error);
  tx->committed = true; return true;
}
bool file_close(file_transaction *tx, file_error *error) {
  if (tx->closed) return true;
  bool ok = true;
  if (tx->source != INVALID_HANDLE_VALUE && !CloseHandle(tx->source)) ok = system_error(error);
  tx->source = INVALID_HANDLE_VALUE;
  if (tx->staged != INVALID_HANDLE_VALUE) {
    if (!tx->committed) { FILE_DISPOSITION_INFO disposition = { TRUE }; if (!SetFileInformationByHandle(tx->staged, FileDispositionInfo, &disposition, sizeof(disposition))) ok = system_error(error); }
    if (!CloseHandle(tx->staged)) ok = system_error(error);
  }
  tx->staged = INVALID_HANDLE_VALUE;
  while (tx->directory_count) if (!CloseHandle(tx->directories[--tx->directory_count])) ok = system_error(error);
  free(tx->path); tx->path = NULL; tx->closed = true;
  return ok;
}
