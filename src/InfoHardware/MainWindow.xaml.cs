using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using InfoHardware.Core;
using InfoHardware.Services;
using InfoHardware.Views;

namespace InfoHardware;

public partial class MainWindow : Window
{
    const int HotkeyOverlay = 0x4801, HotkeyRecord = 0x4802;
    const uint ModCtrl = 0x2, ModShift = 0x4, ModNoRepeat = 0x4000;

    readonly Dictionary<string, Func<UserControl>> _factories;
    readonly Dictionary<string, UserControl> _pages = [];
    OverlayWindow? _overlay;
    IntPtr _hwnd;

    AppState State => AppState.Instance;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = State;
        _factories = new()
        {
            [nameof(NavDashboard)] = () => new DashboardView(),
            [nameof(NavHardware)] = () => new HardwareView(),
            [nameof(NavSensors)] = () => new SensorsView(),
            [nameof(NavPerformance)] = () => new PerformanceView(),
            [nameof(NavOverlay)] = () => new OverlaySettingsView(),
            [nameof(NavSettings)] = () => new SettingsView(),
        };
        Navigate(nameof(NavDashboard), "Painel");

        // Abre direto em uma página: InfoHardware.exe --page Sensors
        var args = Environment.GetCommandLineArgs();
        var i = Array.IndexOf(args, "--page");
        if (i >= 0 && i + 1 < args.Length && FindName("Nav" + args[i + 1]) is RadioButton start) start.IsChecked = true;

        SourceInitialized += OnSourceInitialized;
        StateChanged += (_, _) => UpdateMaximizedState();
        State.Settings.PropertyChanged += OnSettingsChanged;
        Loaded += (_, _) => UpdateOverlay();
        Closed += (_, _) => _overlay?.Close();
    }

    void Nav_Checked(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton rb && _factories != null)
            Navigate(rb.Name, rb.Content?.ToString() ?? "");
    }

    void Navigate(string key, string title)
    {
        if (!_pages.TryGetValue(key, out var page))
            _pages[key] = page = _factories[key]();
        PageHost.Content = page;
        PageTitle.Text = title;
    }

    // ------------------------------------------------------------ overlay
    void OnSettingsChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Settings.OverlayEnabled)) UpdateOverlay();
    }

    void UpdateOverlay()
    {
        if (State.Settings.OverlayEnabled)
        {
            _overlay ??= new OverlayWindow();
            _overlay.Show();
        }
        else _overlay?.Hide();
    }

    // ------------------------------------------------------------ janela
    void OnSourceInitialized(object? sender, EventArgs e)
    {
        _hwnd = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);
        RegisterHotKey(_hwnd, HotkeyOverlay, ModCtrl | ModShift | ModNoRepeat, (uint)'O');
        RegisterHotKey(_hwnd, HotkeyRecord, ModCtrl | ModShift | ModNoRepeat, (uint)'R');

        // Cantos arredondados do Windows 11 + borda escura
        int round = 2;
        DwmSetWindowAttribute(_hwnd, 33, ref round, sizeof(int));
        int dark = 1;
        DwmSetWindowAttribute(_hwnd, 20, ref dark, sizeof(int));
        int border = 0x00521A2E; // COLORREF (BGR) = #2E1A52
        DwmSetWindowAttribute(_hwnd, 34, ref border, sizeof(int));
    }

    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WM_HOTKEY = 0x0312;
        if (msg == WM_HOTKEY)
        {
            switch (wParam.ToInt32())
            {
                case HotkeyOverlay: State.Settings.OverlayEnabled = !State.Settings.OverlayEnabled; handled = true; break;
                case HotkeyRecord: State.Recorder.Toggle(); handled = true; break;
            }
        }
        return IntPtr.Zero;
    }

    void UpdateMaximizedState()
    {
        bool max = WindowState == WindowState.Maximized;
        // Com WindowChrome a janela maximizada ultrapassa a tela pela espessura da borda.
        RootBorder.Margin = max ? new Thickness(7) : new Thickness(0);
        RootBorder.BorderThickness = max ? new Thickness(0) : new Thickness(1);
        MaxButton.Content = max ? "" : "";
        MaxButton.ToolTip = max ? "Restaurar" : "Maximizar";
    }

    void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    void Maximize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
    void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        if (_hwnd != IntPtr.Zero)
        {
            UnregisterHotKey(_hwnd, HotkeyOverlay);
            UnregisterHotKey(_hwnd, HotkeyRecord);
        }
        base.OnClosed(e);
    }

    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
