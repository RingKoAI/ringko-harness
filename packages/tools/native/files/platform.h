#ifndef RINGKO_FILE_PLATFORM_H
#define RINGKO_FILE_PLATFORM_H

#include <stddef.h>
#include <stdint.h>
#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
typedef wchar_t file_char;
#else
#include <sys/stat.h>
typedef char file_char;
#endif

enum { FILE_MAX_BYTES = 64 * 1024 * 1024, FILE_CHUNK_BYTES = 64 * 1024, FILE_MAX_DEPTH = 256, FILE_TEMP_CHARS = 128, FILE_MAX_ATTRIBUTES = 128 };
enum file_kind { FILE_WRITE, FILE_EDIT, FILE_REMOVE, FILE_STORAGE_LOCK, FILE_READ };
struct file_error { const char *code; const char *message; };
struct file_info { bool exists; uint64_t size; double mtime_ms; char identity[128]; };
struct file_transaction {
  file_transaction *next;
  bool closed, committed, existed, staged_ready, flushed;
  enum file_kind kind;
  uint64_t written, read_bytes;
  file_char *path;
  struct file_info original;
  struct file_info result;
#if defined(_WIN32)
  HANDLE directories[FILE_MAX_DEPTH + 1];
  size_t directory_count;
  HANDLE source, staged;
  BY_HANDLE_FILE_INFORMATION original_windows;
#else
  int parent, source, staged;
  int directories[FILE_MAX_DEPTH + 1];
  size_t directory_count;
  char *leaf;
  char temporary[FILE_TEMP_CHARS];
  struct stat original_stat;
#endif
};

bool file_begin(file_transaction *, file_char *, enum file_kind, bool, file_error *);
bool file_read(file_transaction *, void *, size_t, size_t *, file_error *);
bool file_stage(file_transaction *, const char *, file_error *);
bool file_write(file_transaction *, const void *, size_t, file_error *);
bool file_flush(file_transaction *, file_error *);
bool file_commit(file_transaction *, file_info *, file_error *);
bool file_remove(file_transaction *, const char *, file_error *);
bool file_close(file_transaction *, file_error *);

inline bool file_refuse(file_error *error, const char *code, const char *message) {
  error->code = code; error->message = message; return false;
}
#endif
