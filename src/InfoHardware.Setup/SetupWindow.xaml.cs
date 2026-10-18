using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;

namespace InfoHardware.Setup
{
    public partial class SetupWindow : Window
    {
        string _installedDir;
        bool _busy;

        public SetupWindow()
        {
            InitializeComponent();
            VersionText.Text = "Versão " + Installer.Version;
            var existing = Installer.InstalledDir();
            DirBox.Text = existing ?? Installer.DefaultDir;
            if (existing != null)
            {
                InstallBtn.Content = "Atualizar";
                ExistingText.Text = $"Versão {Installer.InstalledVersion() ?? "anterior"} já instalada — será atualizada.";
            }
        }

        void Browse_Click(object sender, RoutedEventArgs e)
        {
            using (var dlg = new System.Windows.Forms.FolderBrowserDialog { Description = "Escolha onde instalar o InfoHardware", SelectedPath = DirBox.Text })
            {
                if (dlg.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
                var path = dlg.SelectedPath;
                if (!path.TrimEnd('\\').EndsWith(Installer.AppName, StringComparison.OrdinalIgnoreCase))
                    path = Path.Combine(path, Installer.AppName);
                DirBox.Text = path;
            }
        }

        async void Install_Click(object sender, RoutedEventArgs e)
        {
            if (Installer.IsAppRunning())
            {
                MessageBox.Show(this, "O InfoHardware está aberto. Feche-o e clique em Instalar novamente.", "InfoHardware", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var o = new InstallOptions
            {
                Dir = DirBox.Text.Trim(),
                DesktopShortcut = DesktopCheck.IsChecked == true,
                StartMenuShortcut = StartCheck.IsChecked == true,
            };
            bool run = RunCheck.IsChecked == true;

            _busy = true;
            CloseBtn.IsEnabled = false;
            OptionsPanel.Visibility = Visibility.Collapsed;
            ProgressPanel.Visibility = Visibility.Visible;
            try
            {
                _installedDir = await Task.Run(() => Installer.Install(o, (p, msg) =>
                    Dispatcher.BeginInvoke(new Action(() => { Bar.Value = p; StatusText.Text = msg; }))));
                ProgressPanel.Visibility = Visibility.Collapsed;
                DonePanel.Visibility = Visibility.Visible;
                DoneText.Text = _installedDir;
                if (run) Installer.LaunchApp(_installedDir);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Falha na instalação:\n\n" + ex.Message, "InfoHardware", MessageBoxButton.OK, MessageBoxImage.Error);
                ProgressPanel.Visibility = Visibility.Collapsed;
                OptionsPanel.Visibility = Visibility.Visible;
            }
            finally
            {
                _busy = false;
                CloseBtn.IsEnabled = true;
            }
        }

        void Finish_Click(object sender, RoutedEventArgs e) => Close();

        void Close_Click(object sender, RoutedEventArgs e)
        {
            if (!_busy) Close();
        }
    }
}
