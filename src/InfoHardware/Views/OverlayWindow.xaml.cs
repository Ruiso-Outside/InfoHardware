using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using InfoHardware.Core;
using InfoHardware.Services;

namespace InfoHardware.Views;

/// <summary>
/// Janela transparente, sempre no topo e que ignora o mouse — fica por cima de jogos em modo
/// "janela sem bordas" / "janela em tela cheia". Em tela cheia exclusiva o Windows não permite
/// janelas de outros programas por cima (só overlays injetados no jogo, que anti-cheats bloqueiam).
/// </summary>
public partial class OverlayWindow : Window
{
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_NOACTIVATE = 0x8000000;
    static readonly IntPtr HWND_TOPMOST = new(-1);
    const uint SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
    const uint EVENT_SYSTEM_FOREGROUND = 0x3, WINEVENT_OUTOFCONTEXT = 0;
    const double EdgeGap = 14;

    readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };
    readonly WinEventProc _onForeground; // referência mantida para o GC não coletar o callback
    IntPtr _hwnd, _hook;

    Settings Settings => AppState.Instance.Settings;

    public OverlayWindow()
    {
        InitializeComponent();
        DataContext = AppState.Instance;
        _onForeground = (_, _, _, _, _, _, _) => Dispatcher.BeginInvoke(PlaceOnTop);

        SourceInitialized += (_, _) =>
        {
            _hwnd = new WindowInteropHelper(this).Handle;
            int ex = GetWindowLong(_hwnd, GWL_EXSTYLE);
            SetWindowLong(_hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE);
            // Quando outro programa (o jogo) ganha o foco, traz o overlay de volta para o topo na hora.
            _hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _onForeground, 0, 0, WINEVENT_OUTOFCONTEXT);
        };
        SizeChanged += (_, _) => PlaceOnTop();
        IsVisibleChanged += (_, _) =>
        {
            if (IsVisible) { PlaceOnTop(); _timer.Start(); }
            else _timer.Stop();
        };
        // O jogo pode mudar a resolução da tela (ex.: resolução esticada); recalcula sempre.
        _timer.Tick += (_, _) => PlaceOnTop();
        Settings.PropertyChanged += OnSettingsChanged;
        Closed += (_, _) =>
        {
            Settings.PropertyChanged -= OnSettingsChanged;
            _timer.Stop();
            if (_hook != IntPtr.Zero) UnhookWinEvent(_hook);
        };
    }

    void OnSettingsChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(Settings.OverlayPosition) or nameof(Settings.OverlayScale)) PlaceOnTop();
    }

    /// <summary>Posiciona em pixels reais no monitor onde está a janela em foco (o jogo) e reafirma o "sempre no topo".</summary>
    void PlaceOnTop()
    {
        if (_hwnd == IntPtr.Zero || !IsVisible) return;

        var fg = GetForegroundWindow();
        var monitor = MonitorFromWindow(fg != IntPtr.Zero ? fg : _hwnd, 1 /* MONITOR_DEFAULTTOPRIMARY */);
        var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref mi)) return;
        GetWindowRect(_hwnd, out var wr);

        int w = wr.Right - wr.Left, h = wr.Bottom - wr.Top;
        var m = mi.rcMonitor;
        double scale = VisualTreeHelper_GetScale();
        int gap = (int)Math.Round(EdgeGap * scale);
        var pos = Settings.OverlayPosition;

        int x = pos.EndsWith("Right") ? m.Right - w - gap
              : pos.EndsWith("Center") ? m.Left + (m.Right - m.Left - w) / 2
              : m.Left + gap;
        int y = pos.StartsWith("Bottom") ? m.Bottom - h - gap : m.Top + gap;

        SetWindowPos(_hwnd, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    double VisualTreeHelper_GetScale() => System.Windows.Media.VisualTreeHelper.GetDpi(this).DpiScaleX;

    delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr hmod, WinEventProc proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
}
