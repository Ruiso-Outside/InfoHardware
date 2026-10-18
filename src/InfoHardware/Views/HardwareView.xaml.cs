using System.Text;
using System.Windows;
using System.Windows.Controls;
using InfoHardware.Core;
using InfoHardware.Services;
using Microsoft.Win32;

namespace InfoHardware.Views;

public partial class HardwareView : UserControl
{
    public HardwareView() => InitializeComponent();

    static string BuildReport() => SystemInfoService.BuildReport(AppState.Instance.Sections);

    void Copy_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText(BuildReport());
            MessageBox.Show("Relatório copiado para a área de transferência.", "InfoHardware", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch { }
    }

    void Export_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new SaveFileDialog
        {
            FileName = $"InfoHardware_{Environment.MachineName}_{DateTime.Now:yyyy-MM-dd}.txt",
            Filter = "Arquivo de texto (*.txt)|*.txt",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
        };
        if (dlg.ShowDialog() != true) return;

        var sb = new StringBuilder(BuildReport());
        sb.AppendLine().AppendLine().AppendLine("### RELATÓRIO DETALHADO DOS SENSORES (LibreHardwareMonitor)").AppendLine();
        try { sb.Append(AppState.Instance.Hardware.GetReport()); } catch { }
        File.WriteAllText(dlg.FileName, sb.ToString(), Encoding.UTF8);
        Actions.SelectFile(dlg.FileName);
    }
}
