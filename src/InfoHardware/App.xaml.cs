using System.Windows;
using System.Windows.Threading;
using InfoHardware.Core;
using InfoHardware.Services;

namespace InfoHardware;

public partial class App : Application
{
    Mutex? _mutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        // Diagnóstico: InfoHardware.exe --report arquivo.txt  (gera o relatório completo dos sensores e sai)
        if (e.Args.Length >= 2 && e.Args[0] == "--report")
        {
            var c = new LibreHardwareMonitor.Hardware.Computer
            {
                IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true, IsMotherboardEnabled = true,
                IsControllerEnabled = true, IsNetworkEnabled = true, IsStorageEnabled = true, IsBatteryEnabled = true, IsPsuEnabled = true
            };
            try
            {
                c.Open();
                File.WriteAllText(e.Args[1], c.GetReport());
            }
            catch (Exception ex) { File.WriteAllText(e.Args[1], ex.ToString()); }
            finally { c.Close(); }
            Shutdown();
            return;
        }

        _mutex = new Mutex(true, @"Global\InfoHardware.SingleInstance", out bool isNew);
        if (!isNew)
        {
            MessageBox.Show("O InfoHardware já está aberto.", "InfoHardware", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        // Números no padrão brasileiro (vírgula decimal) em todo o app, inclusive no CSV das sessões.
        var pt = System.Globalization.CultureInfo.GetCultureInfo("pt-BR");
        System.Globalization.CultureInfo.DefaultThreadCurrentCulture = pt;
        System.Globalization.CultureInfo.CurrentCulture = pt;
        FrameworkElement.LanguageProperty.OverrideMetadata(typeof(FrameworkElement),
            new FrameworkPropertyMetadata(System.Windows.Markup.XmlLanguage.GetLanguage(pt.IetfLanguageTag)));

        DispatcherUnhandledException += OnUnhandled;
        AppDomain.CurrentDomain.UnhandledException += (_, a) => Log(a.ExceptionObject as Exception);
        base.OnStartup(e);

        AppState.Instance.Start();
        var main = new MainWindow();
        MainWindow = main;
        main.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { AppState.Instance.Shutdown(); } catch { }
        _mutex?.Dispose();
        base.OnExit(e);
    }

    void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log(e.Exception);
        e.Handled = true;
    }

    static void Log(Exception? ex)
    {
        if (ex == null) return;
        try
        {
            Directory.CreateDirectory(Settings.Folder);
            File.AppendAllText(Path.Combine(Settings.Folder, "erros.log"), $"[{DateTime.Now:dd/MM/yyyy HH:mm:ss}] {ex}\n\n");
        }
        catch { }
    }
}
