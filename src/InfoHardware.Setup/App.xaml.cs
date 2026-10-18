using System;
using System.Linq;
using System.Windows;

namespace InfoHardware.Setup
{
    /// <summary>
    /// Uso:
    ///   InfoHardware-Setup.exe                         instalação com interface
    ///   InfoHardware-Setup.exe /silent [/dir=C:\...] [/noshortcuts] [/run]
    ///   Uninstall.exe /uninstall [/silent]
    /// </summary>
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            var args = e.Args;
            bool Has(string flag) => args.Any(a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
            string dirArg = args.FirstOrDefault(a => a.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase))?.Substring(5).Trim('"');
            bool silent = Has("/silent");

            try
            {
                if (Has("/uninstall"))
                {
                    if (Installer.RelocateForUninstall(args)) { Shutdown(0); return; }
                    var dir = dirArg ?? Installer.InstalledDir();
                    if (!silent && MessageBox.Show("Deseja remover o InfoHardware deste computador?\n\nAs sessões gravadas em Documentos\\InfoHardware serão mantidas.",
                            "Desinstalar InfoHardware", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                    {
                        Installer.ScheduleSelfDelete();
                        Shutdown(1);
                        return;
                    }
                    Installer.Uninstall(dir);
                    if (!silent) MessageBox.Show("O InfoHardware foi removido.", "Desinstalar InfoHardware", MessageBoxButton.OK, MessageBoxImage.Information);
                    Installer.ScheduleSelfDelete();
                    Shutdown(0);
                    return;
                }

                if (!Installer.HasPayload(out _, out _))
                {
                    MessageBox.Show("Para remover o InfoHardware use \"Configurações > Aplicativos\" do Windows.", "InfoHardware", MessageBoxButton.OK, MessageBoxImage.Information);
                    Shutdown(1);
                    return;
                }

                if (silent)
                {
                    var o = new InstallOptions();
                    if (!string.IsNullOrEmpty(dirArg)) o.Dir = dirArg;
                    else if (Installer.InstalledDir() is string existing) o.Dir = existing;
                    if (Has("/noshortcuts")) o.DesktopShortcut = o.StartMenuShortcut = false;
                    var final = Installer.Install(o, (_, __) => { });
                    if (Has("/run")) Installer.LaunchApp(final);
                    Shutdown(0);
                    return;
                }

                var w = new SetupWindow();
                w.Closed += (_, __) => Shutdown(0);
                w.Show();
            }
            catch (Exception ex)
            {
                if (!silent) MessageBox.Show(ex.Message, "InfoHardware", MessageBoxButton.OK, MessageBoxImage.Error);
                else Console.Error.WriteLine(ex);
                Shutdown(2);
            }
        }
    }
}
