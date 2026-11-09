#include "platform.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/xattr.h>
#include <sys/file.h>
#if defined(__APPLE__)
#include <sys/acl.h>
#endif

static bool system_error(file_error *error, int code = errno) {
  const char *name = code == ENOENT ? "ENOENT" : code == EEXIST ? "EEXIST" : code == EACCES ? "EACCES" :
    code == EPERM ? "EPERM" : code == ELOOP ? "ELOOP" : code == ENOTDIR ? "ENOTDIR" : code == ENOSPC ? "ENOSPC" : "EIO";
  return file_refuse(error, name, "Safe native file operation failed; retry if the target changed.");
}
static void information(const struct stat *value, file_info *info) {
  info->exists = true; info->size = static_cast<uint64_t>(value->st_size);
#if defined(__APPLE__)
  info->mtime_ms = static_cast<double>(value->st_mtimespec.tv_sec) * 1000 + static_cast<double>(value->st_mtimespec.tv_nsec) / 1000000;
#else
  info->mtime_ms = static_cast<double>(value->st_mtim.tv_sec) * 1000 + static_cast<double>(value->st_mtim.tv_nsec) / 1000000;
#endif
  snprintf(info->identity, sizeof(info->identity), "posix:%llu:%llu", static_cast<unsigned long long>(value->st_dev), static_cast<unsigned long long>(value->st_ino));
}
bool file_begin(file_transaction *tx, file_char *path, enum file_kind kind, bool absent, file_error *error) {
  tx->path = path; tx->kind = kind; tx->parent = tx->source = tx->staged = -1;
  if (path[0] != '/') return file_refuse(error, "EINVAL", "An absolute file target is required.");
  char *last = strrchr(path, '/');
  if (!last || !last[1]) return file_refuse(error, "EINVAL", "A regular file target is required.");
  tx->leaf = strdup(last + 1);
  if (!tx->leaf) return file_refuse(error, "ENOMEM", "Could not allocate a file path.");
  tx->parent = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (tx->parent < 0) return system_error(error);
  tx->directories[tx->directory_count++] = tx->parent;
  const size_t parent_length = static_cast<size_t>(last - path);
  *last = 0; char *component = parent_length ? path + 1 : NULL; size_t depth = 0;
  while (component && *component) {
    char *end = strchr(component, '/'); if (end) *end = 0;
    if (++depth > FILE_MAX_DEPTH || !strcmp(component, ".") || !strcmp(component, "..")) return file_refuse(error, "EINVAL", "File path exceeds its safe component limits.");
    int next = openat(tx->parent, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0 && (kind == FILE_WRITE || kind == FILE_STORAGE_LOCK) && errno == ENOENT) {
      if (mkdirat(tx->parent, component, 0755) && errno != EEXIST) return system_error(error);
      next = openat(tx->parent, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    }
    if (next < 0) return system_error(error);
    tx->parent = next; tx->directories[tx->directory_count++] = next;
    if (!end) break;
    component = end + 1;
  }
  tx->source = openat(tx->parent, tx->leaf, (kind == FILE_STORAGE_LOCK ? O_RDWR | O_CREAT : O_RDONLY) | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0600);
  if (tx->source < 0) { if (errno != ENOENT) return system_error(error); if (kind == FILE_EDIT) return file_refuse(error, "ENOENT", "Edit target was not found."); }
  else {
    tx->existed = true;
    if (fstat(tx->source, &tx->original_stat)) return system_error(error);
    if (!S_ISREG(tx->original_stat.st_mode)) return file_refuse(error, "ENOTREG", "A regular file target is required.");
    information(&tx->original_stat, &tx->original);
#if defined(__APPLE__) && defined(UF_COMPRESSED)
    if ((kind == FILE_WRITE || kind == FILE_EDIT) && (tx->original_stat.st_flags & UF_COMPRESSED)) return file_refuse(error, "ENOTSUP", "Atomic replacement of filesystem-compressed files requires a metadata-aware editor; the original file was not changed.");
#endif
    if (kind == FILE_STORAGE_LOCK) {
      if (tx->original.size != 0 || tx->original_stat.st_nlink != 1) return file_refuse(error, "EINVAL", "Upload lock must be an empty, single-linked regular file.");
      if (flock(tx->source, LOCK_EX | LOCK_NB)) {
        if (errno == EWOULDBLOCK || errno == EAGAIN) return file_refuse(error, "EBUSY", "Upload storage is in use by another backend; retry shortly.");
        return system_error(error);
      }
    }
  }
  if (absent && tx->existed) return file_refuse(error, "EEXIST", "Write target appeared after approval; retry the call.");
  if (kind == FILE_EDIT && tx->original.size > FILE_MAX_BYTES) return file_refuse(error, "EFBIG", "Edit source exceeds the 64 MiB size limit.");
  return true;
}
bool file_read(file_transaction *tx, void *data, size_t length, size_t *count, file_error *error) {
  ssize_t received; do { received = read(tx->source, data, length); } while (received < 0 && errno == EINTR);
  if (received < 0) return system_error(error);
  tx->read_bytes += static_cast<uint64_t>(received);
  if (tx->read_bytes > FILE_MAX_BYTES) return file_refuse(error, "EFBIG", "Edit source exceeds the 64 MiB size limit.");
  *count = static_cast<size_t>(received); return true;
}
static bool copy_permissions(file_transaction *tx, file_error *error) {
  struct stat staged;
  if (fstat(tx->staged, &staged)) return system_error(error);
  if ((staged.st_uid != tx->original_stat.st_uid || staged.st_gid != tx->original_stat.st_gid) && fchown(tx->staged, tx->original_stat.st_uid, tx->original_stat.st_gid)) return file_refuse(error, "EPERM", "Cannot safely preserve file ownership during atomic replacement.");
  if (fchmod(tx->staged, tx->original_stat.st_mode & 0777)) return system_error(error);
#if defined(__APPLE__)
  acl_t acl = acl_get_fd(tx->source);
  if (!acl) { if (errno == ENOENT || errno == ENOTSUP) return true; return system_error(error); }
  const bool ok = acl_set_fd(tx->staged, acl) == 0;
  const int code = errno; acl_free(acl);
  return ok ? true : system_error(error, code);
#else
  const char *key = "system.posix_acl_access";
  ssize_t size = fgetxattr(tx->source, key, NULL, 0);
  if (size < 0) { if (errno == ENODATA || errno == ENOTSUP) return true; return system_error(error); }
  if (size > FILE_CHUNK_BYTES) return file_refuse(error, "EFBIG", "File ACL exceeds the supported size.");
  char *data = static_cast<char *>(malloc(static_cast<size_t>(size > 0 ? size : 1)));
  if (!data) return file_refuse(error, "ENOMEM", "Could not allocate ACL metadata.");
  bool ok = fgetxattr(tx->source, key, data, static_cast<size_t>(size)) == size && fsetxattr(tx->staged, key, data, static_cast<size_t>(size), 0) == 0;
  const int code = errno; free(data);
  return ok ? true : system_error(error, code);
#endif
}
static ssize_t attribute_names(int fd, char *data, size_t size) {
#if defined(__APPLE__)
  return flistxattr(fd, data, size, 0);
#else
  return flistxattr(fd, data, size);
#endif
}
static ssize_t attribute_value(int fd, const char *name, void *data, size_t size) {
#if defined(__APPLE__)
  return fgetxattr(fd, name, data, size, 0, 0);
#else
  return fgetxattr(fd, name, data, size);
#endif
}
static bool copy_attributes(file_transaction *tx, file_error *error) {
  const ssize_t size = attribute_names(tx->source, NULL, 0);
  if (size < 0) { if (errno == ENOTSUP) return true; return system_error(error); }
  if (size > FILE_CHUNK_BYTES) return file_refuse(error, "EFBIG", "File metadata exceeds its byte budget.");
  if (!size) return true;
  char *names = static_cast<char *>(malloc(static_cast<size_t>(size)));
  if (!names) return file_refuse(error, "ENOMEM", "Could not allocate file metadata.");
  bool ok = attribute_names(tx->source, names, static_cast<size_t>(size)) == size;
  if (!ok) { free(names); return file_refuse(error, "ESTALE", "File metadata changed; retry the call."); }
  size_t position = 0, bytes = 0, count = 0;
  while (position < static_cast<size_t>(size)) {
    const size_t length = strnlen(names + position, static_cast<size_t>(size) - position);
    if (length == static_cast<size_t>(size) - position || ++count > FILE_MAX_ATTRIBUTES) { ok = file_refuse(error, "EFBIG", "File metadata exceeds its entry budget."); break; }
    const char *name = names + position; position += length + 1;
    // These privilege/content signatures are invalidated by normal file writes.
    if (!strcmp(name, "security.capability") || !strcmp(name, "security.ima") || !strcmp(name, "security.evm") || !strcmp(name, "system.posix_acl_access") || !strcmp(name, "com.apple.decmpfs")) continue;
    const ssize_t length_value = attribute_value(tx->source, name, NULL, 0);
    if (length_value < 0) { ok = system_error(error); break; }
    if (static_cast<size_t>(length_value) > FILE_CHUNK_BYTES - bytes) { ok = file_refuse(error, "EFBIG", "File metadata exceeds its byte budget."); break; }
    bytes += static_cast<size_t>(length_value);
    void *data = malloc(static_cast<size_t>(length_value ? length_value : 1));
    if (!data) { ok = file_refuse(error, "ENOMEM", "Could not allocate file metadata."); break; }
    if (attribute_value(tx->source, name, data, static_cast<size_t>(length_value)) != length_value) ok = file_refuse(error, "ESTALE", "File metadata changed; retry the call.");
    else {
      bool same = false;
      if (attribute_value(tx->staged, name, NULL, 0) == length_value) {
        void *current = malloc(static_cast<size_t>(length_value ? length_value : 1));
        if (!current) { free(data); ok = file_refuse(error, "ENOMEM", "Could not allocate file metadata."); break; }
        same = attribute_value(tx->staged, name, current, static_cast<size_t>(length_value)) == length_value && !memcmp(current, data, static_cast<size_t>(length_value));
        free(current);
      }
      if (!same) {
#if defined(__APPLE__)
        if (fsetxattr(tx->staged, name, data, static_cast<size_t>(length_value), 0, 0)) ok = system_error(error);
#else
        if (fsetxattr(tx->staged, name, data, static_cast<size_t>(length_value), 0)) ok = system_error(error);
#endif
      }
    }
    free(data); if (!ok) break;
  }
  free(names); return ok;
}
bool file_stage(file_transaction *tx, const char *name, file_error *error) {
  snprintf(tx->temporary, sizeof(tx->temporary), "%s", name);
  tx->staged = openat(tx->parent, tx->temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (tx->staged < 0) return system_error(error);
  tx->staged_ready = true;
  return !tx->existed || (copy_permissions(tx, error) && copy_attributes(tx, error));
}
bool file_write(file_transaction *tx, const void *data, size_t length, file_error *error) {
  size_t position = 0;
  while (position < length) {
    ssize_t written = write(tx->staged, static_cast<const char *>(data) + position, length - position);
    if (written < 0 && errno == EINTR) continue;
    if (written < 0) return system_error(error);
    if (!written) return file_refuse(error, "EIO", "File write made no progress.");
    position += static_cast<size_t>(written);
  }
  tx->written += length; tx->flushed = false; return true;
}
bool file_flush(file_transaction *tx, file_error *error) { if (fsync(tx->staged)) return system_error(error); tx->flushed = true; return true; }
bool file_commit(file_transaction *tx, file_info *result, file_error *error) {
  struct stat staged, actual;
  if (fstatat(tx->parent, tx->temporary, &staged, AT_SYMLINK_NOFOLLOW) || fstat(tx->staged, &actual)) return system_error(error);
  if (staged.st_dev != actual.st_dev || staged.st_ino != actual.st_ino || !S_ISREG(staged.st_mode)) return file_refuse(error, "ESTALE", "Temporary file changed before commit; retry the call.");
  if (tx->existed) {
    struct stat current;
    if (fstatat(tx->parent, tx->leaf, &current, AT_SYMLINK_NOFOLLOW)) return system_error(error);
    if (current.st_dev != tx->original_stat.st_dev || current.st_ino != tx->original_stat.st_ino || current.st_size != tx->original_stat.st_size || staged.st_dev != actual.st_dev || staged.st_ino != actual.st_ino) return file_refuse(error, "ESTALE", "File changed during the operation; retry the call.");
#if defined(__APPLE__)
    if (current.st_mtimespec.tv_sec != tx->original_stat.st_mtimespec.tv_sec || current.st_mtimespec.tv_nsec != tx->original_stat.st_mtimespec.tv_nsec) return file_refuse(error, "ESTALE", "File changed during the operation; retry the call.");
#else
    if (current.st_mtim.tv_sec != tx->original_stat.st_mtim.tv_sec || current.st_mtim.tv_nsec != tx->original_stat.st_mtim.tv_nsec) return file_refuse(error, "ESTALE", "File changed during the operation; retry the call.");
#endif
    if (renameat(tx->parent, tx->temporary, tx->parent, tx->leaf)) return system_error(error);
    tx->temporary[0] = 0;
  } else if (linkat(tx->parent, tx->temporary, tx->parent, tx->leaf, 0)) {
    if (errno == ENOTSUP || errno == EOPNOTSUPP || errno == ENOSYS) return file_refuse(error, "ENOTSUP", "Exclusive file creation requires same-directory hard-link support on this filesystem.");
    return system_error(error);
  }
  tx->committed = true;
  struct stat value; if (fstat(tx->staged, &value)) return system_error(error);
  information(&value, result);
  tx->result = *result;
  return fsync(tx->parent) == 0 ? true : system_error(error);
}
bool file_remove(file_transaction *tx, const char *identity, file_error *error) {
  if (!tx->existed) return true;
  if (strcmp(tx->original.identity, identity)) return file_refuse(error, "ESTALE", "Cleanup target identity changed; refusing removal.");
  if (unlinkat(tx->parent, tx->leaf, 0)) return system_error(error);
  tx->committed = true; return true;
}
bool file_close(file_transaction *tx, file_error *error) {
  if (tx->closed) return true;
  bool ok = true;
  if (tx->staged >= 0) {
    if (tx->temporary[0] && unlinkat(tx->parent, tx->temporary, 0) && errno != ENOENT) ok = system_error(error);
    if (close(tx->staged)) ok = system_error(error);
  }
  if (tx->source >= 0 && close(tx->source)) ok = system_error(error);
  while (tx->directory_count) if (close(tx->directories[--tx->directory_count])) ok = system_error(error);
  tx->parent = tx->source = tx->staged = -1;
  free(tx->path); free(tx->leaf); tx->path = tx->leaf = NULL; tx->closed = true;
  return ok;
}
