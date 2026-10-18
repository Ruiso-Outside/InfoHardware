using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using InfoHardware.Core;
using InfoHardware.Services;

namespace InfoHardware.Views;

public partial class SettingsView : UserControl, INotifyPropertyChanged
{
    static readonly Brush Ok = (Brush)Application.Current.FindResource("GreenBrush");
    static readonly Brush Bad = (Brush)Application.Current.FindResource("OrangeBrush");

    public event PropertyChangedEventHandler? PropertyChanged;

    AppState S => AppState.Instance;

    public SettingsView()
    {
        InitializeComponent();
        S.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(AppState.PawnIoInstalled))
            {
                PropertyChanged?.Invoke(this, new(nameof(PawnText)));
                PropertyChanged?.Invoke(this, new(nameof(PawnBrush)));
            }
        };
    }

    public string AdminText => S.IsAdmin ? "Ativa" : "Não";
    public Brush AdminBrush => S.IsAdmin ? Ok : Bad;
    public string PawnText => S.PawnIoInstalled ? "Instalado" : "Não instalado";
    public Brush PawnBrush => S.PawnIoInstalled ? Ok : Bad;
    public string FpsText => S.FpsActive ? "Ativa" : "Inativa";
    public Brush FpsBrush => S.FpsActive ? Ok : Bad;

    void CheckPawn_Click(object sender, RoutedEventArgs e) => S.RefreshPawnIo();
    void InstallPawn_Click(object sender, RoutedEventArgs e) => Actions.InstallPawnIo();
    void Sessions_Click(object sender, RoutedEventArgs e) => Actions.OpenFolder(SessionRecorder.Folder);
    void Config_Click(object sender, RoutedEventArgs e) => Actions.OpenFolder(Settings.Folder);
    void Install_Click(object sender, RoutedEventArgs e) => Actions.OpenFolder(AppContext.BaseDirectory);
}
