using System.Diagnostics;
using System.Windows;

namespace InfoHardware.Core;

public static class Actions
{
    /// <summary>Abre um terminal com o winget instalando o driver PawnIO (usuário confirma os termos no console).</summary>
    public static void InstallPawnIo()
    {
        var r = MessageBox.Show(
            "O PawnIO é o driver usado pelo LibreHardwareMonitor para ler temperatura e consumo da CPU, ventoinhas e tensões da placa-mãe.\n\n" +
            "Será aberto um terminal executando:\n  winget install --id namazso.PawnIO -e\n\n" +
            "Após concluir, reinicie o InfoHardware. Continuar?",
            "Instalar driver PawnIO", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (r != MessageBoxResult.Yes) return;
        try
        {
            Process.Start(new ProcessStartInfo("cmd.exe", "/k winget install --id namazso.PawnIO -e && echo. && echo Concluido! Reinicie o InfoHardware.")
            {
                UseShellExecute = true
            });
        }
        catch
        {
            OpenUrl("https://pawnio.eu/");
        }
    }

    public static void OpenFolder(string path)
    {
        try
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
        }
        catch { }
    }

    public static void SelectFile(string file)
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{file}\"") { UseShellExecute = true }); }
        catch { }
    }

    public static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
}
