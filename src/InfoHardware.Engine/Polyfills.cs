// O que o código do app (Services/, escrito para .NET 9) usa e o .NET Framework 4.7.2 não tem.
// Fica só no motor: o app continua compilando o mesmo código sem mudanças.
using System.Diagnostics;

namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}

namespace System
{
    // índice "a partir do fim" (arr[^1])
    internal readonly struct Index
    {
        readonly int _value;
        public Index(int value, bool fromEnd = false) { _value = fromEnd ? ~value : value; }
        public int Value => _value < 0 ? ~_value : _value;
        public bool IsFromEnd => _value < 0;
        public int GetOffset(int length) => IsFromEnd ? length - ~_value : _value;
        public static implicit operator Index(int value) => new(value);
    }

    internal static class CompatExtensions
    {
        public static bool Contains(this string s, string value, StringComparison comparison) => s.IndexOf(value, comparison) >= 0;
        public static void Deconstruct<TKey, TValue>(this Collections.Generic.KeyValuePair<TKey, TValue> kv, out TKey key, out TValue value)
        {
            key = kv.Key;
            value = kv.Value;
        }
    }
}

namespace InfoHardware.Services
{
    // Environment.TickCount64 e Environment.ProcessId (só no .NET 5+); o resto repassa ao System.Environment
    internal static class Environment
    {
        static readonly Stopwatch Clock = Stopwatch.StartNew();
        static readonly long Start = System.Environment.TickCount;
        public static long TickCount64 => Start + Clock.ElapsedMilliseconds;
        public static int ProcessId { get; } = Process.GetCurrentProcess().Id;
        public static string MachineName => System.Environment.MachineName;
        public static OperatingSystem OSVersion => System.Environment.OSVersion;
        public static int ProcessorCount => System.Environment.ProcessorCount;
        public static bool Is64BitOperatingSystem => System.Environment.Is64BitOperatingSystem;
        public static string UserName => System.Environment.UserName;
        public static string GetFolderPath(System.Environment.SpecialFolder folder) => System.Environment.GetFolderPath(folder);
        public static string GetEnvironmentVariable(string name) => System.Environment.GetEnvironmentVariable(name);
        public static string ExpandEnvironmentVariables(string s) => System.Environment.ExpandEnvironmentVariables(s);
    }
}
