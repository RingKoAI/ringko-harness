#include <node_api.h>
#include "platform.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Resolve the stable Node-API ABI from the current Windows host rather than
// importing node.exe. This works with both Node and Bun, without a delay-load
// dependency on the other runtime. No raw handles or pointers escape to JS.
#define API_FUNCTIONS(X) \
  X(napi_get_cb_info) X(napi_get_value_string_utf8) X(napi_get_value_string_utf16) \
  X(napi_get_value_bool) X(napi_get_value_uint32) X(napi_create_object) X(napi_create_string_utf8) \
  X(napi_create_double) X(napi_get_boolean) X(napi_set_named_property) \
  X(napi_create_external) X(napi_get_value_external) X(napi_set_instance_data) \
  X(napi_get_instance_data) X(napi_create_buffer_copy) X(napi_get_buffer_info) \
  X(napi_create_function) X(napi_get_undefined) X(napi_create_error) X(napi_throw)
struct node_api {
#define FIELD(name) decltype(&::name) name;
  API_FUNCTIONS(FIELD)
#undef FIELD
  bool valid;
};
static node_api load_api() {
  node_api value = {}; value.valid = true;
#if defined(_WIN32)
  HMODULE host = GetModuleHandleW(NULL);
#define RESOLVE(name) { FARPROC address = GetProcAddress(host, #name); static_assert(sizeof(address) == sizeof(value.name), "Node-API function pointer size mismatch"); memcpy(&value.name, &address, sizeof(address)); value.valid = value.valid && value.name != NULL; }
#else
#define RESOLVE(name) value.name = &name;
#endif
  API_FUNCTIONS(RESOLVE)
#undef RESOLVE
  return value;
}
static const node_api api = load_api();
struct environment { file_transaction *head; };

static napi_value raise(napi_env env, const file_error &error) {
  napi_value code, message, value;
  if (api.napi_create_string_utf8(env, error.code ? error.code : "EIO", NAPI_AUTO_LENGTH, &code) == napi_ok &&
      api.napi_create_string_utf8(env, error.message ? error.message : "Native file operation failed.", NAPI_AUTO_LENGTH, &message) == napi_ok &&
      api.napi_create_error(env, code, message, &value) == napi_ok) api.napi_throw(env, value);
  return NULL;
}
static napi_value invalid(napi_env env) { file_error error = { "EINVAL", "Invalid native file operation arguments." }; return raise(env, error); }
static napi_value nothing(napi_env env) { napi_value value = NULL; return api.napi_get_undefined(env, &value) == napi_ok ? value : NULL; }
static bool arguments(napi_env env, napi_callback_info info, size_t count, napi_value *values) {
  size_t actual = count;
  return api.napi_get_cb_info(env, info, &actual, values, NULL, NULL) == napi_ok && actual == count;
}
static file_transaction *transaction(napi_env env, napi_value value, bool allow_closed = false) {
  void *pointer = NULL, *data = NULL;
  if (api.napi_get_value_external(env, value, &pointer) != napi_ok || api.napi_get_instance_data(env, &data) != napi_ok || !data) return NULL;
  environment *state = static_cast<environment *>(data);
  for (file_transaction *tx = state->head; tx; tx = tx->next) if (tx == pointer) return allow_closed || !tx->closed ? tx : NULL;
  return NULL;
}
static char *text(napi_env env, napi_value value, size_t max) {
  size_t length;
  if (api.napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || length > max) return NULL;
  char *result = static_cast<char *>(malloc(length + 1)); if (!result) return NULL;
  size_t written;
  if (api.napi_get_value_string_utf8(env, value, result, length + 1, &written) != napi_ok || written != length || memchr(result, 0, length)) { free(result); return NULL; }
  return result;
}
static bool property(napi_env env, napi_value object, const char *name, napi_value value) { return api.napi_set_named_property(env, object, name, value) == napi_ok; }
static napi_value details(napi_env env, const file_info &info) {
  napi_value result, exists, size, time, identity;
  if (api.napi_create_object(env, &result) != napi_ok || api.napi_get_boolean(env, info.exists, &exists) != napi_ok ||
      api.napi_create_double(env, static_cast<double>(info.size), &size) != napi_ok || api.napi_create_double(env, info.mtime_ms, &time) != napi_ok ||
      api.napi_create_string_utf8(env, info.identity, NAPI_AUTO_LENGTH, &identity) != napi_ok ||
      !property(env, result, "exists", exists) || !property(env, result, "size", size) || !property(env, result, "mtimeMs", time) || !property(env, result, "identity", identity)) return NULL;
  return result;
}
static void finalize(napi_env, void *data, void *) {
  environment *state = static_cast<environment *>(data);
  for (file_transaction *tx = state->head; tx;) { file_transaction *next = tx->next; file_error error = {}; file_close(tx, &error); free(tx); tx = next; }
  free(state);
}
static napi_value begin(napi_env env, napi_callback_info call) {
  napi_value values[3]; bool absent;
  if (!arguments(env, call, 3, values) || api.napi_get_value_bool(env, values[2], &absent) != napi_ok) return invalid(env);
  char *kind = text(env, values[1], 16); if (!kind) return invalid(env);
  enum file_kind mode = !strcmp(kind, "write") ? FILE_WRITE : !strcmp(kind, "edit") ? FILE_EDIT : !strcmp(kind, "remove") ? FILE_REMOVE : !strcmp(kind, "lock") ? FILE_STORAGE_LOCK : FILE_READ;
  bool valid_kind = !strcmp(kind, "write") || !strcmp(kind, "edit") || !strcmp(kind, "remove") || !strcmp(kind, "lock") || !strcmp(kind, "read"); free(kind);
  if (!valid_kind) return invalid(env);
  file_char *path = NULL;
#if defined(_WIN32)
  size_t length;
  if (api.napi_get_value_string_utf16(env, values[0], NULL, 0, &length) != napi_ok || length > 32768 || length < 3) return invalid(env);
  char16_t *input = static_cast<char16_t *>(calloc(length + 1, sizeof(char16_t)));
  if (!input) return invalid(env);
  size_t written;
  if (api.napi_get_value_string_utf16(env, values[0], input, length + 1, &written) != napi_ok || written != length) { free(input); return invalid(env); }
  const bool extended = length >= 4 && input[0] == '\\' && input[1] == '\\' && input[2] == '?' && input[3] == '\\';
  const size_t prefix = extended ? 0 : 4;
  path = static_cast<wchar_t *>(calloc(length + prefix + 1, sizeof(wchar_t)));
  if (!path) { free(input); return invalid(env); }
  if (prefix) memcpy(path, L"\\\\?\\", prefix * sizeof(wchar_t));
  for (size_t index = 0; index < length; index++) { if (!input[index]) { free(input); free(path); return invalid(env); } path[prefix + index] = static_cast<wchar_t>(input[index] == '/' ? '\\' : input[index]); }
  free(input);
#else
  path = text(env, values[0], 131072); if (!path) return invalid(env);
#endif
  void *data = NULL;
  if (api.napi_get_instance_data(env, &data) != napi_ok || !data) { free(path); return invalid(env); }
  environment *state = static_cast<environment *>(data);
  file_transaction *tx = static_cast<file_transaction *>(calloc(1, sizeof(file_transaction)));
  if (!tx) { free(path); return invalid(env); }
  tx->next = state->head; state->head = tx;
  file_error error = {};
  if (!file_begin(tx, path, mode, absent, &error)) { file_error cleanup = {}; file_close(tx, &cleanup); return raise(env, error); }
  napi_value result;
  if (api.napi_create_external(env, tx, NULL, NULL, &result) != napi_ok) { file_close(tx, &error); return NULL; }
  return result;
}
static napi_value info(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); return tx ? details(env, tx->original) : invalid(env);
}
static napi_value read_chunk(napi_env env, napi_callback_info call) {
  napi_value values[2]; size_t count_args = 2;
  if (api.napi_get_cb_info(env, call, &count_args, values, NULL, NULL) != napi_ok || count_args < 1 || count_args > 2) return invalid(env);
  uint32_t length = FILE_CHUNK_BYTES;
  if (count_args == 2 && (api.napi_get_value_uint32(env, values[1], &length) != napi_ok || !length || length > FILE_CHUNK_BYTES)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); if (!tx || (tx->kind != FILE_EDIT && tx->kind != FILE_READ) || !tx->existed || tx->committed) return invalid(env);
  char buffer[FILE_CHUNK_BYTES]; size_t count = 0; file_error error = {};
  if (!file_read(tx, buffer, length, &count, &error)) return raise(env, error);
  napi_value result; return api.napi_create_buffer_copy(env, count, buffer, NULL, &result) == napi_ok ? result : NULL;
}
static napi_value stage(napi_env env, napi_callback_info call) {
  napi_value values[2]; if (!arguments(env, call, 2, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); char *name = text(env, values[1], FILE_TEMP_CHARS - 1);
  if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || tx->staged_ready || tx->committed || !name) { free(name); return invalid(env); }
  bool valid = strncmp(name, ".ringko-write-", 14) == 0;
  for (const char *p = name; *p; p++) if (!( (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-' || *p == '.')) valid = false;
  file_error error = {}; bool ok = valid && file_stage(tx, name, &error); free(name);
  if (!valid) return invalid(env);
  if (!ok) return raise(env, error);
  return nothing(env);
}
static napi_value write_chunk(napi_env env, napi_callback_info call) {
  napi_value values[2]; if (!arguments(env, call, 2, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); void *data; size_t length;
  if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || !tx->staged_ready || tx->committed || api.napi_get_buffer_info(env, values[1], &data, &length) != napi_ok || length > FILE_CHUNK_BYTES || tx->written > FILE_MAX_BYTES || length > FILE_MAX_BYTES - tx->written) return invalid(env);
  file_error error = {}; if (!file_write(tx, data, length, &error)) return raise(env, error);
  return nothing(env);
}
static napi_value flush(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || !tx->staged_ready || tx->committed) return invalid(env);
  file_error error = {}; if (!file_flush(tx, &error)) return raise(env, error);
  return nothing(env);
}
static napi_value commit(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || !tx->staged_ready || !tx->flushed || tx->committed) return invalid(env);
  file_error error = {}; file_info result = {};
  if (!file_commit(tx, &result, &error)) return raise(env, error);
  return details(env, result);
}
static napi_value remove_file(napi_env env, napi_callback_info call) {
  napi_value values[2]; if (!arguments(env, call, 2, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0]); char *identity = text(env, values[1], 128);
  if (!tx || tx->kind != FILE_REMOVE || !identity) { free(identity); return invalid(env); }
  file_error error = {}; bool ok = file_remove(tx, identity, &error); free(identity);
  if (!ok) return raise(env, error);
  return nothing(env);
}
static napi_value close_file(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], true); if (!tx) return invalid(env);
  file_error error = {}; if (!file_close(tx, &error)) return raise(env, error);
  return nothing(env);
}
static napi_value status(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], true); if (!tx) return invalid(env);
  napi_value result = details(env, tx->result), committed;
  if (!result || api.napi_get_boolean(env, tx->committed, &committed) != napi_ok || !property(env, result, "committed", committed)) return NULL;
  return result;
}
NAPI_MODULE_INIT() {
  if (!api.valid) { fprintf(stderr, "Secure file module requires Node-API v8 support.\n"); return NULL; }
  environment *state = static_cast<environment *>(calloc(1, sizeof(environment)));
  if (!state) return invalid(env);
  if (api.napi_set_instance_data(env, state, finalize, NULL) != napi_ok) { free(state); return NULL; }
  struct function { const char *name; napi_callback callback; } functions[] = {
    { "begin", begin }, { "info", info }, { "read", read_chunk }, { "stage", stage }, { "write", write_chunk },
    { "flush", flush }, { "commit", commit }, { "remove", remove_file }, { "close", close_file }, { "status", status },
  };
  for (const auto &entry : functions) {
    napi_value value;
    if (api.napi_create_function(env, entry.name, NAPI_AUTO_LENGTH, entry.callback, NULL, &value) != napi_ok || !property(env, exports, entry.name, value)) return NULL;
  }
  return exports;
}
