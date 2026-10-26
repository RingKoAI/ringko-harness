using System;
using System.ComponentModel;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

internal static class Program
{
    private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    private const uint SE_GROUP_LOGON_ID = 0xC0000000;
    private const uint DISABLE_MAX_PRIVILEGE = 0x1;
    private const uint LUA_TOKEN = 0x4;
    private const uint WRITE_RESTRICTED = 0x8;
    private const uint CREATE_SUSPENDED = 0x4;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x400;
    private const uint STARTF_USESTDHANDLES = 0x100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
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

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUserW(
        IntPtr token, string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessWithTokenW(
        IntPtr token, uint logonFlags, string applicationName, StringBuilder commandLine,
        uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

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
        return Regex.IsMatch(key, "(?i)(token|key|secret|password|passwd|credential)s?$");
    }

    private static IntPtr BuildEnvironment(string temp)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            string key = Convert.ToString(entry.Key);
            if (string.IsNullOrEmpty(key) || Sensitive(key) || key == "=") continue;
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

        IntPtr current = IntPtr.Zero, logon = IntPtr.Zero, everyone = IntPtr.Zero, workspaceSidPtr = IntPtr.Zero, environment = IntPtr.Zero,
            tempSidPtr = IntPtr.Zero, restrict = IntPtr.Zero, token = IntPtr.Zero, job = IntPtr.Zero,
            stdout = IntPtr.Zero, stderr = IntPtr.Zero, stdin = IntPtr.Zero;
        string stage = "open-token";
        try
        {
            if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT, out current))
                throw new InvalidOperationException(Describe("OpenProcessToken"));
            logon = LogonSid(current);
            everyone = Sid("S-1-1-0");
            string workspaceSid = WorkspaceSid(workspace, false);
            string tempSid = WorkspaceSid(temp, true);
            workspaceSidPtr = Sid(workspaceSid);
            tempSidPtr = Sid(tempSid);

            // DACL grants are prepared by the caller before the process starts.

            var sids = mode == "workspace-write"
                ? new[] { logon, everyone, workspaceSidPtr, tempSidPtr }
                : new[] { logon, everyone, tempSidPtr };
            int restrictCount = sids.Length;
            restrict = Marshal.AllocHGlobal(16 * restrictCount);
            for (int i = 0; i < restrictCount; i++)
            {
                Marshal.WriteIntPtr(restrict, i * 16, sids[i]);
                Marshal.WriteInt32(restrict, i * 16 + 8, 0);
            }
            stage = "restricted-token";
            token = RestrictedToken(current, restrict, restrictCount);
            stage = "default-dacl";
            GrantDefaultDacl(token, everyone);

            stage = "job";
            job = CreateJob();
            stdin = Inheritable(STD_INPUT_HANDLE);
            stdout = Inheritable(STD_OUTPUT_HANDLE);
            stderr = Inheritable(STD_ERROR_HANDLE);
            var startup = new STARTUPINFO
            {
                cb = Marshal.SizeOf(typeof(STARTUPINFO)),
                dwFlags = (int)STARTF_USESTDHANDLES,
                hStdInput = stdin,
                hStdOutput = stdout,
                hStdError = stderr,
            };
            var line = new StringBuilder();
            line.Append(Quote(command));
            foreach (string value in commandArgs) line.Append(' ').Append(Quote(value));
            PROCESS_INFORMATION process;
            stage = "environment";
            environment = BuildEnvironment(temp);
            stage = "create-process";
            bool created = CreateProcessAsUserW(token, null, line, IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, environment, cwd, ref startup, out process);
            if (!created)
            {
                uint error = ErrorCode;
                created = CreateProcessWithTokenW(token, 0, null, line, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                    environment, cwd, ref startup, out process);
                if (!created) throw new InvalidOperationException(Describe("CreateProcessAsUserW/CreateProcessWithTokenW") + " (asuser=0x" + error.ToString("X8") + ")");
            }
            try
            {
                if (!AssignProcessToJobObject(job, process.hProcess)) throw new InvalidOperationException(Describe("AssignProcessToJobObject"));
                if (ResumeThread(process.hThread) == uint.MaxValue) throw new InvalidOperationException(Describe("ResumeThread"));
                WaitForSingleObject(process.hProcess, uint.MaxValue);
                uint exitCode;
                if (!GetExitCodeProcess(process.hProcess, out exitCode)) throw new InvalidOperationException(Describe("GetExitCodeProcess"));
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
            Console.Error.WriteLine("sandbox[" + stage + "]: " + error.Message);
            return 125;
        }
        finally
        {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (restrict != IntPtr.Zero) Marshal.FreeHGlobal(restrict);
            if (current != IntPtr.Zero) CloseHandle(current);
            if (logon != IntPtr.Zero) Marshal.FreeHGlobal(logon);
            if (everyone != IntPtr.Zero) LocalFree(everyone);
            if (workspaceSidPtr != IntPtr.Zero) LocalFree(workspaceSidPtr);
            if (tempSidPtr != IntPtr.Zero) LocalFree(tempSidPtr);
            if (stdin != IntPtr.Zero) CloseHandle(stdin);
            if (stdout != IntPtr.Zero) CloseHandle(stdout);
            if (stderr != IntPtr.Zero) CloseHandle(stderr);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
    }

    private static int Main(string[] args) { return Run(args); }
}






















