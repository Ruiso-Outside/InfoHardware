using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace InfoHardware.Setup
{
    public sealed class InstallOptions
    {
        public string Dir = Installer.DefaultDir;
        public bool DesktopShortcut = true;
        public bool StartMenuShortcut = true;
    }

    /// <summary>
    /// Formato do Setup.exe: [stub do instalador][payload.zip][tamanho do payload: int64][assinatura "IHPAYLD1"].
    /// O stub sozinho (sem payload) é gravado como Uninstall.exe na pasta do programa.
    /// </summary>
    public static class Installer
    {
        public const string AppName = "InfoHardware";
        public const string ExeName = "InfoHardware.exe";
        public const string UninstallerName = "Uninstall.exe";
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\InfoHardware";
        static readonly byte[] Magic = Encoding.ASCII.GetBytes("IHPAYLD1");

        public static string Version => Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
        public static string SelfPath => Process.GetCurrentProcess().MainModule.FileName;

        public static string DefaultDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);

        static string StartMenuLink =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk");
        static string DesktopLink =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");

        // ------------------------------------------------------------------ payload
        public static bool HasPayload(out long stubLength, out long payloadLength)
        {
            stubLength = payloadLength = 0;
            using (var fs = File.OpenRead(SelfPath))
            {
                if (fs.Length < 16) return false;
                fs.Seek(-16, SeekOrigin.End);
                var footer = new byte[16];
                fs.Read(footer, 0, 16);
                if (!footer.Skip(8).SequenceEqual(Magic)) { stubLength = fs.Length; return false; }
                payloadLength = BitConverter.ToInt64(footer, 0);
                stubLength = fs.Length - 16 - payloadLength;
                return payloadLength > 0 && stubLength > 0;
            }
        }

        public static string InstalledDir()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey))
                return k?.GetValue("InstallLocation") as string;
        }

        public static string InstalledVersion()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey))
                return k?.GetValue("DisplayVersion") as string;
        }

        public static bool IsAppRunning() => Process.GetProcessesByName(Path.GetFileNameWithoutExtension(ExeName)).Length > 0;

        // ------------------------------------------------------------------ instalação
        /// <summary>Instala e devolve a pasta final usada.</summary>
        public static string Install(InstallOptions o, Action<double, string> progress)
        {
            if (!HasPayload(out long stubLen, out long payloadLen))
                throw new InvalidOperationException("Este instalador não contém os arquivos do programa.");
            if (IsAppRunning())
                throw new InvalidOperationException("O InfoHardware está aberto. Feche-o e tente novamente.");

            var dir = Path.GetFullPath(o.Dir);
            // Nunca instala "solto" numa pasta com outros arquivos — a desinstalação apaga a pasta inteira.
            if (Directory.Exists(dir) && Directory.EnumerateFileSystemEntries(dir).Any() && !File.Exists(Path.Combine(dir, ExeName)))
                dir = Path.Combine(dir, AppName);
            progress(0, "Preparando a pasta de instalação…");
            if (Directory.Exists(dir) && File.Exists(Path.Combine(dir, ExeName)))
            {
                // Atualização: remove a versão anterior para não deixar arquivos órfãos.
                foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) TryDelete(f);
            }
            Directory.CreateDirectory(dir);

            progress(0.02, "Lendo pacote…");
            byte[] zipBytes = new byte[payloadLen];
            byte[] stub = new byte[stubLen];
            using (var fs = File.OpenRead(SelfPath))
            {
                ReadExactly(fs, stub);
                ReadExactly(fs, zipBytes);
            }

            using (var zip = new ZipArchive(new MemoryStream(zipBytes), ZipArchiveMode.Read))
            {
                var entries = zip.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();
                var root = dir.TrimEnd('\\') + "\\";
                for (int i = 0; i < entries.Count; i++)
                {
                    var e = entries[i];
                    var dest = Path.GetFullPath(Path.Combine(dir, e.FullName));
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // proteção contra caminhos maliciosos
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    e.ExtractToFile(dest, true);
                    if (i % 8 == 0) progress(0.05 + 0.85 * i / entries.Count, "Copiando " + e.Name);
                }
            }

            progress(0.92, "Registrando o desinstalador…");
            var exe = Path.Combine(dir, ExeName);
            var uninstaller = Path.Combine(dir, UninstallerName);
            File.WriteAllBytes(uninstaller, stub);
            Register(dir, exe, uninstaller);

            progress(0.96, "Criando atalhos…");
            if (o.StartMenuShortcut) CreateShortcut(StartMenuLink, exe, dir);
            if (o.DesktopShortcut) CreateShortcut(DesktopLink, exe, dir);
            progress(1, "Concluído");
            return dir;
        }

        static void ReadExactly(Stream s, byte[] buffer)
        {
            int off = 0;
            while (off < buffer.Length)
            {
                int n = s.Read(buffer, off, buffer.Length - off);
                if (n <= 0) throw new EndOfStreamException();
                off += n;
            }
        }

        static void Register(string dir, string exe, string uninstaller)
        {
            long sizeKb = Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length) / 1024;
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", AppName);
                k.SetValue("DisplayVersion", Version);
                k.SetValue("Publisher", AppName);
                k.SetValue("DisplayIcon", exe);
                k.SetValue("InstallLocation", dir);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("UninstallString", $"\"{uninstaller}\" /uninstall");
                k.SetValue("QuietUninstallString", $"\"{uninstaller}\" /uninstall /silent");
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, sizeKb), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        static void CreateShortcut(string linkPath, string target, string workDir)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(linkPath));
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object lnk = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
                var t = lnk.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { target + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "Informações e monitoramento de hardware em tempo real" });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
                Marshal.FinalReleaseComObject(lnk);
            }
            finally { Marshal.FinalReleaseComObject(shell); }
        }

        public static void LaunchApp(string dir)
        {
            try { Process.Start(new ProcessStartInfo(Path.Combine(dir, ExeName)) { UseShellExecute = true, WorkingDirectory = dir }); }
            catch { /* usuário pode recusar o UAC */ }
        }

        // ------------------------------------------------------------------ desinstalação
        public static void Uninstall(string dir)
        {
            if (IsAppRunning())
                throw new InvalidOperationException("O InfoHardware está aberto. Feche-o e tente novamente.");

            TryDelete(StartMenuLink);
            TryDelete(DesktopLink);
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }

            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir) && File.Exists(Path.Combine(dir, ExeName)))
            {
                for (int attempt = 0; attempt < 5 && Directory.Exists(dir); attempt++)
                {
                    try { Directory.Delete(dir, true); }
                    catch { Thread.Sleep(600); }
                }
            }
            // Configurações (pequenas). As sessões gravadas em Documentos são preservadas.
            try { Directory.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName), true); } catch { }
        }

        /// <summary>O desinstalador não consegue apagar a si mesmo: roda uma cópia temporária e agenda a remoção dela.</summary>
        public static bool RelocateForUninstall(string[] args)
        {
            if (args.Any(a => a.Equals("/relocated", StringComparison.OrdinalIgnoreCase))) return false;

            var self = SelfPath;
            var copy = Path.Combine(Path.GetTempPath(), "InfoHardware-Uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.Copy(self, copy, true);
            var dir = Path.GetDirectoryName(self);
            var extra = string.Join(" ", args.Where(a => !a.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase)).Select(a => "\"" + a + "\""));
            Process.Start(new ProcessStartInfo(copy, $"{extra} /relocated \"/dir={dir}\"") { UseShellExecute = false });
            return true;
        }

        public static void ScheduleSelfDelete()
        {
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", $"/c ping -n 3 127.0.0.1 >nul & del /f /q \"{SelfPath}\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
            }
            catch { }
        }

        static void TryDelete(string f)
        {
            try { if (File.Exists(f)) File.Delete(f); } catch { }
        }
    }
}
