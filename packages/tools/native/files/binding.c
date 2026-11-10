#include <node_api.h>
#include "platform.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Stable Node-API v8 signatures, checked against the official C headers. */
#define API_FUNCTIONS(X) \
  X(napi_get_cb_info, (napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **)) \
  X(napi_get_value_string_utf8, (napi_env, napi_value, char *, size_t, size_t *)) \
  X(napi_get_value_string_utf16, (napi_env, napi_value, char16_t *, size_t, size_t *)) \
  X(napi_get_value_bool, (napi_env, napi_value, bool *)) \
  X(napi_get_value_uint32, (napi_env, napi_value, uint32_t *)) \
  X(napi_create_object, (napi_env, napi_value *)) \
  X(napi_create_string_utf8, (napi_env, const char *, size_t, napi_value *)) \
  X(napi_create_double, (napi_env, double, napi_value *)) \
  X(napi_get_boolean, (napi_env, bool, napi_value *)) \
  X(napi_set_named_property, (napi_env, napi_value, const char *, napi_value)) \
  X(napi_create_external, (napi_env, void *, node_api_basic_finalize, void *, napi_value *)) \
  X(napi_get_value_external, (napi_env, napi_value, void **)) \
  X(napi_set_instance_data, (node_api_basic_env, void *, napi_finalize, void *)) \
  X(napi_get_instance_data, (node_api_basic_env, void **)) \
  X(napi_create_buffer_copy, (napi_env, size_t, const void *, void **, napi_value *)) \
  X(napi_get_buffer_info, (napi_env, napi_value, void **, size_t *)) \
  X(napi_create_function, (napi_env, const char *, size_t, napi_callback, void *, napi_value *)) \
  X(napi_get_undefined, (napi_env, napi_value *)) \
  X(napi_create_error, (napi_env, napi_value, napi_value, napi_value *)) \
  X(napi_throw, (napi_env, napi_value))

#define API_TYPE(name, parameters) \
  typedef napi_status (NAPI_CDECL *name##_function) parameters; \
  _Static_assert(_Generic(&name, name##_function: 1, default: 0), "Node-API signature mismatch: " #name);
API_FUNCTIONS(API_TYPE)
#undef API_TYPE
typedef struct node_api {
#define API_FIELD(name, parameters) name##_function name;
  API_FUNCTIONS(API_FIELD)
#undef API_FIELD
  bool valid;
} node_api;

#if defined(_WIN32)
/* Shared by all environments; InitOnce publishes an immutable function table. */
static INIT_ONCE api_once = INIT_ONCE_STATIC_INIT;
static node_api api;
static BOOL CALLBACK initialize_api(PINIT_ONCE once, PVOID parameter, PVOID *context) {
  (void)once; (void)parameter; (void)context;
  HMODULE host = GetModuleHandleW(NULL);
  api.valid = true;
#define API_RESOLVE(name, parameters) { \
  FARPROC address = GetProcAddress(host, #name); \
  _Static_assert(sizeof(address) == sizeof(api.name), "Node-API function pointer size mismatch"); \
  memcpy(&api.name, &address, sizeof(address)); api.valid = api.valid && api.name != NULL; }
  API_FUNCTIONS(API_RESOLVE)
#undef API_RESOLVE
  return TRUE;
}
#else
#define API_DIRECT(name, parameters) .name = &name,
static const node_api api = { API_FUNCTIONS(API_DIRECT) .valid = true };
#undef API_DIRECT
#endif

typedef struct environment { file_transaction *head; } environment;
static napi_value raise_error(napi_env env, const file_error *error) {
  napi_value code, message, value;
  if (api.napi_create_string_utf8(env, error->code ? error->code : "EIO", NAPI_AUTO_LENGTH, &code) == napi_ok &&
      api.napi_create_string_utf8(env, error->message ? error->message : "Native file operation failed.", NAPI_AUTO_LENGTH, &message) == napi_ok &&
      api.napi_create_error(env, code, message, &value) == napi_ok) api.napi_throw(env, value);
  return NULL;
}
static napi_value invalid(napi_env env) { file_error error = { "EINVAL", "Invalid native file operation arguments." }; return raise_error(env, &error); }
static napi_value nothing(napi_env env) { napi_value value = NULL; return api.napi_get_undefined(env, &value) == napi_ok ? value : NULL; }
static bool arguments(napi_env env, napi_callback_info info, size_t count, napi_value *values) {
  size_t actual = count;
  return api.napi_get_cb_info(env, info, &actual, values, NULL, NULL) == napi_ok && actual == count;
}
static file_transaction *transaction(napi_env env, napi_value value, bool allow_closed) {
  void *pointer = NULL, *data = NULL;
  if (api.napi_get_value_external(env, value, &pointer) != napi_ok || api.napi_get_instance_data(env, &data) != napi_ok || !data) return NULL;
  environment *state = data;
  for (file_transaction *tx = state->head; tx; tx = tx->next) if (tx == pointer) return allow_closed || !tx->closed ? tx : NULL;
  return NULL;
}
static char *text(napi_env env, napi_value value, size_t max) {
  size_t length;
  if (api.napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || length > max) return NULL;
  char *result = malloc(length + 1); if (!result) return NULL;
  size_t written;
  if (api.napi_get_value_string_utf8(env, value, result, length + 1, &written) != napi_ok || written != length || memchr(result, 0, length)) { free(result); return NULL; }
  return result;
}
static bool property(napi_env env, napi_value object, const char *name, napi_value value) { return api.napi_set_named_property(env, object, name, value) == napi_ok; }
static napi_value details(napi_env env, const file_info *info) {
  napi_value result, exists, size, time, identity;
  if (api.napi_create_object(env, &result) != napi_ok || api.napi_get_boolean(env, info->exists, &exists) != napi_ok ||
      api.napi_create_double(env, (double)info->size, &size) != napi_ok || api.napi_create_double(env, info->mtime_ms, &time) != napi_ok ||
      api.napi_create_string_utf8(env, info->identity, NAPI_AUTO_LENGTH, &identity) != napi_ok ||
      !property(env, result, "exists", exists) || !property(env, result, "size", size) || !property(env, result, "mtimeMs", time) || !property(env, result, "identity", identity)) return NULL;
  return result;
}
/* Each environment owns its transaction records; closing is idempotent. */
static void finalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  environment *state = data;
  for (file_transaction *tx = state->head; tx;) { file_transaction *next = tx->next; file_error error = {0}; file_close(tx, &error); free(tx); tx = next; }
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
  char16_t *input = calloc(length + 1, sizeof(char16_t));
  if (!input) return invalid(env);
  size_t written;
  if (api.napi_get_value_string_utf16(env, values[0], input, length + 1, &written) != napi_ok || written != length) { free(input); return invalid(env); }
  const bool extended = length >= 4 && input[0] == '\\' && input[1] == '\\' && input[2] == '?' && input[3] == '\\';
  const size_t prefix = extended ? 0 : 4;
  path = calloc(length + prefix + 1, sizeof(wchar_t));
  if (!path) { free(input); return invalid(env); }
  if (prefix) memcpy(path, L"\\\\?\\", prefix * sizeof(wchar_t));
  for (size_t index = 0; index < length; index++) { if (!input[index]) { free(input); free(path); return invalid(env); } path[prefix + index] = (wchar_t)(input[index] == '/' ? '\\' : input[index]); }
  free(input);
#else
  path = text(env, values[0], 131072); if (!path) return invalid(env);
#endif
  void *data = NULL;
  if (api.napi_get_instance_data(env, &data) != napi_ok || !data) { free(path); return invalid(env); }
  environment *state = data;
  file_transaction *tx = calloc(1, sizeof(file_transaction));
  if (!tx) { free(path); return invalid(env); }
  tx->next = state->head; state->head = tx;
  file_error error = {0};
  if (!file_begin(tx, path, mode, absent, &error)) { file_error cleanup = {0}; file_close(tx, &cleanup); return raise_error(env, &error); }
  napi_value result;
  if (api.napi_create_external(env, tx, NULL, NULL, &result) != napi_ok) { file_close(tx, &error); return NULL; }
  return result;
}
static napi_value info(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); return tx ? details(env, &tx->original) : invalid(env);
}
static napi_value read_chunk(napi_env env, napi_callback_info call) {
  napi_value values[2]; size_t count_args = 2;
  if (api.napi_get_cb_info(env, call, &count_args, values, NULL, NULL) != napi_ok || count_args < 1 || count_args > 2) return invalid(env);
  uint32_t length = FILE_CHUNK_BYTES;
  if (count_args == 2 && (api.napi_get_value_uint32(env, values[1], &length) != napi_ok || !length || length > FILE_CHUNK_BYTES)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); if (!tx || (tx->kind != FILE_EDIT && tx->kind != FILE_READ) || !tx->existed || tx->committed) return invalid(env);
  char buffer[FILE_CHUNK_BYTES]; size_t count = 0; file_error error = {0};
  if (!file_read(tx, buffer, length, &count, &error)) return raise_error(env, &error);
  napi_value result; return api.napi_create_buffer_copy(env, count, buffer, NULL, &result) == napi_ok ? result : NULL;
}
static napi_value stage(napi_env env, napi_callback_info call) {
  napi_value values[2]; if (!arguments(env, call, 2, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); char *name = text(env, values[1], FILE_TEMP_CHARS - 1);
  if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || tx->staged_ready || tx->committed || !name) { free(name); return invalid(env); }
  bool valid = strncmp(name, ".ringko-write-", 14) == 0;
  for (const char *p = name; *p; p++) if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-' || *p == '.')) valid = false;
  file_error error = {0}; bool ok = valid && file_stage(tx, name, &error); free(name);
  if (!valid) return invalid(env);
  if (!ok) return raise_error(env, &error);
  return nothing(env);
}
static napi_value write_chunk(napi_env env, napi_callback_info call) {
  napi_value values[2]; if (!arguments(env, call, 2, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); void *data; size_t length;
  if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || !tx->staged_ready || tx->committed || api.napi_get_buffer_info(env, values[1], &data, &length) != napi_ok || length > FILE_CHUNK_BYTES || tx->written > FILE_MAX_BYTES || length > FILE_MAX_BYTES - tx->written) return invalid(env);
  file_error error = {0}; if (!file_write(tx, data, length, &error)) return raise_error(env, &error);
  return nothing(env);
}
static napi_value flush(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || !tx->staged_ready || tx->committed) return invalid(env);
  file_error error = {0}; if (!file_flush(tx, &error)) return raise_error(env, &error);
  return nothing(env);
}
static napi_value commit(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); if (!tx || (tx->kind != FILE_WRITE && tx->kind != FILE_EDIT) || !tx->staged_ready || !tx->flushed || tx->committed) return invalid(env);
  file_error error = {0}; file_info result = {0};
  if (!file_commit(tx, &result, &error)) return raise_error(env, &error);
  return details(env, &result);
}
static napi_value remove_file(napi_env env, napi_callback_info call) {
  napi_value values[2]; if (!arguments(env, call, 2, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], false); char *identity = text(env, values[1], 128);
  if (!tx || tx->kind != FILE_REMOVE || !identity) { free(identity); return invalid(env); }
  file_error error = {0}; bool ok = file_remove(tx, identity, &error); free(identity);
  if (!ok) return raise_error(env, &error);
  return nothing(env);
}
static napi_value close_file(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], true); if (!tx) return invalid(env);
  file_error error = {0}; if (!file_close(tx, &error)) return raise_error(env, &error);
  return nothing(env);
}
static napi_value status(napi_env env, napi_callback_info call) {
  napi_value values[1]; if (!arguments(env, call, 1, values)) return invalid(env);
  file_transaction *tx = transaction(env, values[0], true); if (!tx) return invalid(env);
  napi_value result = details(env, &tx->result), committed;
  if (!result || api.napi_get_boolean(env, tx->committed, &committed) != napi_ok || !property(env, result, "committed", committed)) return NULL;
  return result;
}
NAPI_MODULE_INIT() {
#if defined(_WIN32)
  if (!InitOnceExecuteOnce(&api_once, initialize_api, NULL, NULL)) return NULL;
#endif
  if (!api.valid) { fprintf(stderr, "Secure file module requires Node-API v8 support.\n"); return NULL; }
  environment *state = calloc(1, sizeof(environment));
  if (!state) return invalid(env);
  if (api.napi_set_instance_data(env, state, finalize, NULL) != napi_ok) { free(state); return NULL; }
  const struct { const char *name; napi_callback callback; } functions[] = {
    { "begin", begin }, { "info", info }, { "read", read_chunk }, { "stage", stage }, { "write", write_chunk },
    { "flush", flush }, { "commit", commit }, { "remove", remove_file }, { "close", close_file }, { "status", status },
  };
  for (size_t index = 0; index < sizeof(functions) / sizeof(functions[0]); index++) {
    napi_value value;
    if (api.napi_create_function(env, functions[index].name, NAPI_AUTO_LENGTH, functions[index].callback, NULL, &value) != napi_ok || !property(env, exports, functions[index].name, value)) return NULL;
  }
  return exports;
}
