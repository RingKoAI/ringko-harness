using System;
using System.ComponentModel;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Program
{
    private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    private const uint SE_GROUP_LOGON_ID = 0xC0000000;
    private const uint DISABLE_MAX_PRIVILEGE = 0x1;
    private const uint WRITE_RESTRICTED = 0x8;
    private const uint CREATE_SUSPENDED = 0x4;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x400;
    private const uint STARTF_USESTDHANDLES = 0x100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const int MAX_CONTROL_CHARACTERS = 262144;
    private static readonly object OutputLock = new object();

    private sealed class ConsoleState
    {
        public readonly object Sync = new object();
        public IntPtr Handle;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr AttributeList;
    }

    [DllImport("advapi32.dll", EntryPoint = "CreateProcessAsUserW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateRestrictedProcess(
        IntPtr token, string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadFile(IntPtr handle, byte[] buffer, int size, out int read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteFile(IntPtr handle, byte[] buffer, int size, out int written, IntPtr overlapped);
    [DllImport("kernel32.dll")]
    private static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
    [DllImport("kernel32.dll")]
    private static extern int ResizePseudoConsole(IntPtr console, COORD size);
    [DllImport("kernel32.dll")]
    private static extern void ClosePseudoConsole(IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(string path, uint access, uint sharing, IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetStdHandle(int which, IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(string application, StringBuilder line, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length, out int needed);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(
        IntPtr existingToken, uint flags, uint disableCount, IntPtr disableSids,
        uint deleteCount, IntPtr deletePrivileges, uint restrictCount, IntPtr restrictSids,
        out IntPtr newToken);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess,
        out IntPtr targetHandle, uint desiredAccess, bool inheritHandle, uint options);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSidToSidW(string stringSid, out IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int GetLengthSid(IntPtr sid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CopySid(int destinationLength, IntPtr destination, IntPtr source);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static uint ErrorCode { get { return (uint)Marshal.GetLastWin32Error(); } }

    private static string Describe(string api) { return api + " failed: " + new Win32Exception((int)ErrorCode).Message + " (0x" + ErrorCode.ToString("X8") + ")"; }

    private static string Quote(string value)
    {
        if (value.Length == 0) return "\"\"";
        if (value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        var builder = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"') { builder.Append('\\', backslashes * 2 + 1).Append('"'); backslashes = 0; continue; }
            builder.Append('\\', backslashes).Append(c);
            backslashes = 0;
        }
        builder.Append('\\', backslashes * 2).Append('"');
        return builder.ToString();
    }

    private static string CommandLine(string command, string[] args)
    {
        // cmd's /s /c payload has shell quoting rules rather than CRT argv
        // escaping. Preserve the command body verbatim inside its outer quotes.
        if (System.IO.Path.GetFileName(command).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase)
            && args.Length == 4 && args[0].Equals("/d", StringComparison.OrdinalIgnoreCase)
            && args[1].Equals("/s", StringComparison.OrdinalIgnoreCase)
            && (args[2].Equals("/c", StringComparison.OrdinalIgnoreCase) || args[2].Equals("/k", StringComparison.OrdinalIgnoreCase)))
        {
            return Quote(command) + " /d /s " + args[2] + " \"" + args[3] + "\"";
        }
        var line = new StringBuilder(Quote(command));
        foreach (string argument in args) line.Append(' ').Append(Quote(argument));
        return line.ToString();
    }

    private static string WorkspaceSid(string path, bool temp)
    {
        using (var sha = SHA256.Create())
        {
            byte[] input = Encoding.UTF8.GetBytes((temp ? "temp\0" : string.Empty) + path);
            byte[] digest = sha.ComputeHash(input);
            uint first = (BitConverter.ToUInt32(digest, 0) % 1073741823u) + 1u;
            uint second = (BitConverter.ToUInt32(digest, 4) % 1073741823u) + 1u;
            return temp ? "S-1-4-" + first + "-" + second + "-1" : "S-1-4-" + first + "-" + second;
        }
    }

    private static IntPtr LogonSid(IntPtr token)
    {
        int needed;
        GetTokenInformation(token, 2, IntPtr.Zero, 0, out needed);
        if (needed <= 0) throw new InvalidOperationException(Describe("GetTokenInformation(TokenGroups size)"));
        IntPtr groups = Marshal.AllocHGlobal(needed);
        try
        {
            if (!GetTokenInformation(token, 2, groups, needed, out needed))
                throw new InvalidOperationException(Describe("GetTokenInformation(TokenGroups)"));
            int count = Marshal.ReadInt32(groups, 0);
            for (int index = 0; index < count; index++)
            {
                int offset = 8 + index * 16;
                IntPtr sid = Marshal.ReadIntPtr(groups, offset);
                uint attributes = (uint)Marshal.ReadInt32(groups, offset + 8);
                if ((attributes & SE_GROUP_LOGON_ID) == 0) continue;
                int length = GetLengthSid(sid);
                if (length <= 0) throw new InvalidOperationException(Describe("GetLengthSid"));
                IntPtr copy = Marshal.AllocHGlobal(length);
                if (!CopySid(length, copy, sid))
                {
                    Marshal.FreeHGlobal(copy);
                    throw new InvalidOperationException(Describe("CopySid"));
                }
                return copy;
            }
            throw new InvalidOperationException("no logon SID found in process token");
        }
        finally { Marshal.FreeHGlobal(groups); }
    }

    private static IntPtr Sid(string value)
    {
        IntPtr sid;
        if (!ConvertStringSidToSidW(value, out sid)) throw new InvalidOperationException(Describe("ConvertStringSidToSidW(" + value + ")"));
        return sid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TRUSTEE
    {
        public IntPtr pMultipleTrustee;
        public uint MultipleTrusteeOperation;
        public uint TrusteeForm;
        public uint TrusteeType;
        public IntPtr ptstrName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct EXPLICIT_ACCESS
    {
        public uint grfAccessPermissions;
        public uint grfAccessMode;
        public uint grfInheritance;
        public TRUSTEE Trustee;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint SetEntriesInAclW(uint count, ref EXPLICIT_ACCESS entries, IntPtr oldAcl, out IntPtr newAcl);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length);

    private static void GrantDefaultDacl(IntPtr token, IntPtr sid)
    {
        int needed;
        GetTokenInformation(token, 6, IntPtr.Zero, 0, out needed);
        if (needed <= 0) throw new InvalidOperationException(Describe("GetTokenInformation(TokenDefaultDacl size)"));
        IntPtr buffer = Marshal.AllocHGlobal(needed);
        IntPtr newAcl = IntPtr.Zero;
        try
        {
            if (!GetTokenInformation(token, 6, buffer, needed, out needed)) throw new InvalidOperationException(Describe("GetTokenInformation(TokenDefaultDacl)"));
            IntPtr oldAcl = Marshal.ReadIntPtr(buffer, 0);
            var entry = new EXPLICIT_ACCESS
            {
                grfAccessPermissions = 0x1F01FF,
                grfAccessMode = 1,
                grfInheritance = 0,
                Trustee = new TRUSTEE { pMultipleTrustee = IntPtr.Zero, MultipleTrusteeOperation = 0, TrusteeForm = 0, TrusteeType = 0, ptstrName = sid },
            };
            uint result = SetEntriesInAclW(1, ref entry, oldAcl, out newAcl);
            if (result != 0) throw new InvalidOperationException("SetEntriesInAclW failed: 0x" + result.ToString("X8"));
            IntPtr info = Marshal.AllocHGlobal(IntPtr.Size);
            try
            {
                Marshal.WriteIntPtr(info, 0, newAcl);
                if (!SetTokenInformation(token, 6, info, IntPtr.Size)) throw new InvalidOperationException(Describe("SetTokenInformation(TokenDefaultDacl)"));
            }
            finally { Marshal.FreeHGlobal(info); }
        }
        finally
        {
            if (newAcl != IntPtr.Zero) LocalFree(newAcl);
            Marshal.FreeHGlobal(buffer);
        }
    }
    private static IntPtr RestrictedToken(IntPtr current, IntPtr restrict, int count)
    {
        IntPtr token;
        if (!CreateRestrictedToken(current, DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED,
            0, IntPtr.Zero, 0, IntPtr.Zero, (uint)count, restrict, out token))
            throw new InvalidOperationException(Describe("CreateRestrictedToken"));
        return token;
    }

    private static void SetLowIntegrity(IntPtr token)
    {
        IntPtr sid = Sid("S-1-16-4096");
        IntPtr info = Marshal.AllocHGlobal(16);
        try
        {
            Marshal.WriteIntPtr(info, 0, sid);
            Marshal.WriteInt32(info, 8, 0x20);
            Marshal.WriteInt32(info, 12, 0);
            if (!SetTokenInformation(token, 25, info, 16)) throw new InvalidOperationException(Describe("SetTokenInformation(TokenIntegrityLevel)"));
        }
        finally { Marshal.FreeHGlobal(info); LocalFree(sid); }
    }

    private static IntPtr CreateJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException(Describe("CreateJobObject"));
        IntPtr info = Marshal.AllocHGlobal(144);
        try
        {
            for (int i = 0; i < 144; i++) Marshal.WriteByte(info, i, 0);
            Marshal.WriteInt32(info, 16, (int)JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
            if (!SetInformationJobObject(job, 9, info, 144)) throw new InvalidOperationException(Describe("SetInformationJobObject"));
        }
        catch { CloseHandle(job); throw; }
        finally { Marshal.FreeHGlobal(info); }
        return job;
    }

    private static IntPtr Inheritable(int which)
    {
        IntPtr source = GetStdHandle(which);
        if (source == IntPtr.Zero || source == new IntPtr(-1)) return IntPtr.Zero;
        IntPtr duplicate;
        if (!DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), out duplicate, 0, true, 0x2))
            throw new InvalidOperationException(Describe("DuplicateHandle"));
        return duplicate;
    }

    private static bool Sensitive(string key)
    {
        return Regex.IsMatch(key, "(?i)(token|key|secret|password|passwd|credential|authorization|auth|cookie)s?$")
            || Regex.IsMatch(key, "(?i)^(SSH_AUTH_SOCK|SSH_AGENT_PID|GPG_AGENT_INFO|GIT_ASKPASS|SSH_ASKPASS|PSMODULEPATH)$");
    }

    private static IntPtr BuildEnvironment(string temp, HashSet<string> authorized)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            string key = Convert.ToString(entry.Key);
            if (string.IsNullOrEmpty(key) || (Sensitive(key) && !authorized.Contains(key)) || key == "=") continue;
            values[key] = Convert.ToString(entry.Value) ?? string.Empty;
        }
        values["TEMP"] = temp;
        values["TMP"] = temp;
        var keys = new List<string>(values.Keys);
        keys.Sort(StringComparer.OrdinalIgnoreCase);
        var block = new StringBuilder();
        foreach (string key in keys) block.Append(key).Append('=').Append(values[key]).Append('\0');
        block.Append('\0');
        byte[] bytes = Encoding.Unicode.GetBytes(block.ToString());
        IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, memory, bytes.Length);
        return memory;
    }

    private static IntPtr AttributeList(IntPtr attribute, IntPtr value, int length)
    {
        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        if (size == IntPtr.Zero) throw new InvalidOperationException(Describe("InitializeProcThreadAttributeList(size)"));
        IntPtr list = Marshal.AllocHGlobal(size);
        bool initialized = false;
        try
        {
            if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new InvalidOperationException(Describe("InitializeProcThreadAttributeList"));
            initialized = true;
            if (!UpdateProcThreadAttribute(list, 0, attribute, value, new IntPtr(length), IntPtr.Zero, IntPtr.Zero))
                throw new InvalidOperationException(Describe("UpdateProcThreadAttribute"));
            return list;
        }
        catch
        {
            if (initialized) DeleteProcThreadAttributeList(list);
            Marshal.FreeHGlobal(list);
            throw;
        }
    }

    private static void Emit(object message)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(new JavaScriptSerializer { MaxJsonLength = MAX_CONTROL_CHARACTERS }.Serialize(message));
            Console.Out.Flush();
        }
    }

    private static Thread PumpOutput(IntPtr output)
    {
        var thread = new Thread(() =>
        {
            var bytes = new byte[8192];
            var characters = new char[8192];
            Decoder decoder = Encoding.UTF8.GetDecoder();
            int read;
            try
            {
                while (ReadFile(output, bytes, bytes.Length, out read, IntPtr.Zero) && read > 0)
                {
                    int count = decoder.GetChars(bytes, 0, read, characters, 0, false);
                    if (count > 0) Emit(new { type = "output", data = new string(characters, 0, count) });
                }
            }
            catch (System.IO.IOException) { /* The bridge closes its pipe on cancellation. */ }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    private static string ReadControlLine()
    {
        var line = new StringBuilder();
        for (;;)
        {
            int character = Console.In.Read();
            if (character < 0) return line.Length == 0 ? null : line.ToString();
            if (character == '\n') return line.ToString();
            if (line.Length >= MAX_CONTROL_CHARACTERS) throw new InvalidOperationException("Terminal control frame exceeds its limit.");
            line.Append((char)character);
        }
    }

    private static ConsoleState StartControls(IntPtr input, IntPtr console, IntPtr job)
    {
        var state = new ConsoleState { Handle = console };
        var thread = new Thread(() =>
        {
            var parser = new JavaScriptSerializer { MaxJsonLength = MAX_CONTROL_CHARACTERS, RecursionLimit = 8 };
            try
            {
                string line;
                while ((line = ReadControlLine()) != null)
                {
                    var message = parser.Deserialize<Dictionary<string, object>>(line);
                    object type;
                    if (message == null || !message.TryGetValue("type", out type)) throw new InvalidOperationException("Invalid terminal control frame.");
                    if (Equals(type, "dispose")) break;
                    if (Equals(type, "input"))
                    {
                        object data;
                        if (!message.TryGetValue("data", out data) || !(data is string)) throw new InvalidOperationException("Invalid terminal input.");
                        byte[] bytes = Encoding.UTF8.GetBytes((string)data);
                        int offset = 0;
                        while (offset < bytes.Length)
                        {
                            byte[] remaining = new byte[bytes.Length - offset];
                            Buffer.BlockCopy(bytes, offset, remaining, 0, remaining.Length);
                            int written;
                            if (!WriteFile(input, remaining, remaining.Length, out written, IntPtr.Zero) || written <= 0)
                                throw new InvalidOperationException(Describe("WriteFile(ConPTY input)"));
                            offset += written;
                        }
                    }
                    else if (Equals(type, "resize"))
                    {
                        object columns, rows;
                        if (!message.TryGetValue("cols", out columns) || !(columns is int) || !message.TryGetValue("rows", out rows) || !(rows is int))
                            throw new InvalidOperationException("Invalid terminal dimensions.");
                        COORD size = Dimensions((int)columns, (int)rows);
                        lock (state.Sync)
                        {
                            if (state.Handle == IntPtr.Zero) break;
                            int result = ResizePseudoConsole(state.Handle, size);
                            if (result != 0) throw new InvalidOperationException("ResizePseudoConsole failed: 0x" + result.ToString("X8"));
                        }
                    }
                    else throw new InvalidOperationException("Unsupported terminal control frame.");
                }
            }
            catch (Exception error)
            {
                try { Emit(new { type = "error", message = error.Message }); }
                catch (System.IO.IOException) { }
            }
            finally { TerminateJobObject(job, 1); }
        });
        thread.IsBackground = true;
        thread.Start();
        return state;
    }

    private static void ReleaseConsole(ConsoleState state, IntPtr handle)
    {
        if (state != null)
        {
            lock (state.Sync) { handle = state.Handle; state.Handle = IntPtr.Zero; }
        }
        // Closing can block while draining output, so it stays outside the
        // resize critical section and the output channel has its own thread.
        if (handle != IntPtr.Zero) ClosePseudoConsole(handle);
    }

    private static COORD Dimensions(int columns, int rows)
    {
        if (columns < 20 || columns > 300 || rows < 5 || rows > 120) throw new ArgumentException("Terminal dimensions are outside the supported range.");
        return new COORD { X = (short)columns, Y = (short)rows };
    }

    // Alternate-token creation can retain the launcher's redirected stdio even
    // with a pseudoconsole attribute. Reopen the assigned console inside the
    // already-confined child before launching the target with the same token.
    private static int TerminalChild(string[] args)
    {
        IntPtr input = IntPtr.Zero, output = IntPtr.Zero;
        var inherited = new HashSet<IntPtr>();
        try
        {
            foreach (int which in new[] { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE })
            {
                IntPtr handle = GetStdHandle(which);
                if (handle != IntPtr.Zero && handle != new IntPtr(-1)) inherited.Add(handle);
            }
            foreach (IntPtr handle in inherited) if (!SetHandleInformation(handle, 1, 0)) return 125;
            input = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            output = CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (input == new IntPtr(-1) || output == new IntPtr(-1)) return 125;
            if (!SetHandleInformation(input, 1, 1) || !SetHandleInformation(output, 1, 1)) return 125;
            if (!SetStdHandle(STD_INPUT_HANDLE, input) || !SetStdHandle(STD_OUTPUT_HANDLE, output) || !SetStdHandle(STD_ERROR_HANDLE, output)) return 125;
            foreach (IntPtr handle in inherited) CloseHandle(handle);
            inherited.Clear();
            var startup = new STARTUPINFO
            {
                cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = (int)STARTF_USESTDHANDLES,
                hStdInput = input, hStdOutput = output, hStdError = output,
            };
            var arguments = new string[args.Length - 2];
            Array.Copy(args, 2, arguments, 0, arguments.Length);
            var line = new StringBuilder(CommandLine(args[1], arguments));
            PROCESS_INFORMATION process;
            if (!CreateProcessW(null, line, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, null, ref startup, out process)) return 125;
            try
            {
                if (WaitForSingleObject(process.hProcess, uint.MaxValue) == uint.MaxValue) return 125;
                uint exitCode;
                return GetExitCodeProcess(process.hProcess, out exitCode) ? unchecked((int)exitCode) : 125;
            }
            finally { CloseHandle(process.hThread); CloseHandle(process.hProcess); }
        }
        finally
        {
            if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input);
            if (output != IntPtr.Zero && output != new IntPtr(-1)) CloseHandle(output);
            foreach (IntPtr handle in inherited) CloseHandle(handle);
        }
    }
    private static int Run(string[] args)
    {
        if (args.Length < 5 || (args[0] != "read-only" && args[0] != "workspace-write"))
        {
            Console.Error.WriteLine("usage: sandbox-win <read-only|workspace-write> <workspace> <temp> <cwd> -- <command> [args...]");
            return 2;
        }
        string mode = args[0], workspace = args[1], temp = args[2], cwd = args[3];
        int separator = Array.IndexOf(args, "--", 4);
        if (separator < 0 || separator + 1 >= args.Length) return 2;
        string command = args[separator + 1];
        var commandArgs = new string[args.Length - separator - 2];
        Array.Copy(args, separator + 2, commandArgs, 0, commandArgs.Length);

        bool terminal = false;
        COORD dimensions = new COORD { X = 80, Y = 24 };
        var writableRoots = new List<string> { workspace };
        var authorizedEnvironment = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var capabilitySids = new List<IntPtr>();
        var inheritedHandles = new List<IntPtr>();
        IntPtr current = IntPtr.Zero, logon = IntPtr.Zero, everyone = IntPtr.Zero, environment = IntPtr.Zero,
            restrict = IntPtr.Zero, token = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero,
            handleList = IntPtr.Zero, console = IntPtr.Zero, inputRead = IntPtr.Zero,
            inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        Thread outputPump = null;
        ConsoleState consoleState = null;
        string stage = "open-token";
        try
        {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("The native sandbox requires a 64-bit Windows process.");
            for (int index = 4; index < separator; index++)
            {
                if (args[index] == "--writable-root" && index + 1 < separator)
                {
                    if (writableRoots.Count >= 64) throw new ArgumentException("Too many writable sandbox roots.");
                    writableRoots.Add(args[++index]);
                }
                else if (args[index] == "--pty" && index + 2 < separator)
                {
                    terminal = true;
                    dimensions = Dimensions(int.Parse(args[++index]), int.Parse(args[++index]));
                    Console.InputEncoding = new UTF8Encoding(false);
                    Console.OutputEncoding = new UTF8Encoding(false);
                }
                else if (args[index] == "--allow-env" && index + 1 < separator)
                {
                    string name = args[++index];
                    if (authorizedEnvironment.Count >= 256 || name.Length > 128 || !Regex.IsMatch(name, "^[A-Za-z_][A-Za-z0-9_]*$"))
                        throw new ArgumentException("Invalid explicitly authorized environment name.");
                    authorizedEnvironment.Add(name);
                }
                else throw new ArgumentException("Invalid sandbox runner option.");
            }
            if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT, out current))
                throw new InvalidOperationException(Describe("OpenProcessToken"));
            logon = LogonSid(current);
            everyone = Sid("S-1-1-0");
            // Capability grants are prepared by the trusted caller. A read-only
            // token never carries persistent-root capabilities, even if an ACE remains.
            var sids = new List<IntPtr> { logon, everyone };
            if (mode == "workspace-write")
            {
                foreach (string root in writableRoots)
                {
                    IntPtr sid = Sid(WorkspaceSid(root, false));
                    capabilitySids.Add(sid);
                    sids.Add(sid);
                }
            }
            IntPtr temporarySid = Sid(WorkspaceSid(temp, true));
            capabilitySids.Add(temporarySid);
            sids.Add(temporarySid);
            int restrictCount = sids.Count;
            restrict = Marshal.AllocHGlobal(16 * restrictCount);
            for (int i = 0; i < restrictCount; i++)
            {
                Marshal.WriteIntPtr(restrict, i * 16, sids[i]);
                Marshal.WriteInt32(restrict, i * 16 + 8, 0);
                Marshal.WriteInt32(restrict, i * 16 + 12, 0);
            }
            stage = "restricted-token";
            token = RestrictedToken(current, restrict, restrictCount);
            SetLowIntegrity(token);
            stage = "default-dacl";
            GrantDefaultDacl(token, temporarySid);

            stage = "job";
            job = CreateJob();
            var startup = new STARTUPINFOEX
            {
                StartupInfo = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFOEX)) },
            };
            if (terminal)
            {
                stage = "conpty";
                if (!CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0) || !CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0))
                    throw new InvalidOperationException(Describe("CreatePipe(ConPTY)"));
                int result = CreatePseudoConsole(dimensions, inputRead, outputWrite, 0, out console);
                if (result != 0) throw new InvalidOperationException("CreatePseudoConsole failed: 0x" + result.ToString("X8"));
                attributes = AttributeList(new IntPtr(0x00020016), console, IntPtr.Size);
                outputPump = PumpOutput(outputRead);
            }
            else
            {
                foreach (int which in new[] { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE }) inheritedHandles.Add(Inheritable(which));
                startup.StartupInfo.dwFlags = (int)STARTF_USESTDHANDLES;
                startup.StartupInfo.hStdInput = inheritedHandles[0];
                startup.StartupInfo.hStdOutput = inheritedHandles[1];
                startup.StartupInfo.hStdError = inheritedHandles[2];
                var handles = inheritedHandles.FindAll(handle => handle != IntPtr.Zero && handle != new IntPtr(-1));
                if (handles.Count == 0) throw new InvalidOperationException("Sandbox process has no valid standard handles.");
                handleList = Marshal.AllocHGlobal(handles.Count * IntPtr.Size);
                for (int index = 0; index < handles.Count; index++) Marshal.WriteIntPtr(handleList, index * IntPtr.Size, handles[index]);
                attributes = AttributeList(new IntPtr(0x00020002), handleList, handles.Count * IntPtr.Size);
            }
            startup.AttributeList = attributes;
            var line = new StringBuilder();
            if (terminal)
            {
                line.Append(Quote(Environment.GetCommandLineArgs()[0])).Append(" --terminal-child ").Append(Quote(command));
                foreach (string value in commandArgs) line.Append(' ').Append(Quote(value));
            }
            else line.Append(CommandLine(command, commandArgs));
            PROCESS_INFORMATION process;
            stage = "environment";
            environment = BuildEnvironment(temp, authorizedEnvironment);
            stage = "create-process";
            if (!CreateRestrictedProcess(token, null, line, IntPtr.Zero, IntPtr.Zero, !terminal,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT, environment, cwd, ref startup, out process))
                throw new InvalidOperationException(Describe("CreateProcessAsUserW"));
            try
            {
                if (!AssignProcessToJobObject(job, process.hProcess))
                {
                    string error = Describe("AssignProcessToJobObject");
                    TerminateProcess(process.hProcess, 125);
                    throw new InvalidOperationException(error);
                }
                if (ResumeThread(process.hThread) == uint.MaxValue) throw new InvalidOperationException(Describe("ResumeThread"));
                if (terminal)
                {
                    CloseHandle(inputRead); inputRead = IntPtr.Zero;
                    CloseHandle(outputWrite); outputWrite = IntPtr.Zero;
                    consoleState = StartControls(inputWrite, console, job);
                    Emit(new { type = "ready" });
                }
                if (WaitForSingleObject(process.hProcess, uint.MaxValue) == uint.MaxValue) throw new InvalidOperationException(Describe("WaitForSingleObject"));
                uint exitCode;
                if (!GetExitCodeProcess(process.hProcess, out exitCode)) throw new InvalidOperationException(Describe("GetExitCodeProcess"));
                if (terminal)
                {
                    ReleaseConsole(consoleState, console); console = IntPtr.Zero;
                    outputPump.Join(3000);
                    Emit(new { type = "exit", exitCode = unchecked((int)exitCode) });
                }
                return unchecked((int)exitCode);
            }
            finally
            {
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
            }
        }
        catch (Exception error)
        {
            string message = "sandbox[" + stage + "]: " + error.Message;
            if (terminal) Emit(new { type = "error", message = message });
            else Console.Error.WriteLine(message);
            return 125;
        }
        finally
        {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (console != IntPtr.Zero) ReleaseConsole(consoleState, console);
            if (inputRead != IntPtr.Zero) CloseHandle(inputRead);
            if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite);
            if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite);
            if (outputRead != IntPtr.Zero) CloseHandle(outputRead);
            if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (restrict != IntPtr.Zero) Marshal.FreeHGlobal(restrict);
            if (current != IntPtr.Zero) CloseHandle(current);
            if (logon != IntPtr.Zero) Marshal.FreeHGlobal(logon);
            if (everyone != IntPtr.Zero) LocalFree(everyone);
            foreach (IntPtr sid in capabilitySids) LocalFree(sid);
            foreach (IntPtr handle in inheritedHandles) if (handle != IntPtr.Zero) CloseHandle(handle);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length > 1 && args[0] == "--terminal-child") return TerminalChild(args);
        return Run(args);
    }
}






















