// Instala (ou repara) o driver PawnIO a partir do motor, que já roda como administrador.
// O instalador oficial recusa instalar por cima de uma instalação anterior (erro 183, "já existe"), e uma
// instalação que parou no meio deixa o registro e a pasta sem o driver. Por isso:
//   1) remove o que existir (desinstalador com limite de tempo e, se preciso, registro, serviço e pasta à mão);
//   2) roda o instalador oficial (assinado por namazso.eu) em modo silencioso, com limite de tempo;
//   3) confere se o driver abriu e, se não, junta as pistas (bloqueio do Windows, driver não instalado...).

using System;
using System.Diagnostics;
using System.Diagnostics.Eventing.Reader;
using System.IO;
using System.Linq;
using System.Threading;
using Microsoft.Win32;

namespace InfoHardware.Engine;

static class PawnInstall
{
    const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO";
    static string Dir => Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.ProgramFiles), "PawnIO");

    public sealed class Result
    {
        public bool ok;
        public string state = "";
        public string reason = "";   // "", "hung", "blocked", "notInstalled", "failed", "noAdmin"
        public string detail = "";
        public int exitCode;
        public string[] log = Array.Empty<string>();
    }

    public static Result Run(string setup, Func<string> state, Action<string> step)
    {
        var log = new System.Collections.Generic.List<string>();
        void Say(string s) { log.Add($"{DateTime.Now:HH:mm:ss} {s}"); step(s); }
        var r = new Result();
        var started = DateTime.Now;
        try
        {
            if (!File.Exists(setup)) { r.reason = "failed"; r.detail = "Instalador não encontrado: " + setup; return r; }

            // 1) instalação anterior
            if (!Cleanup(Say))
            {
                r.reason = "failed";
                r.detail = "Não foi possível remover a instalação anterior (algum arquivo está em uso). Reinicie o PC e tente de novo.";
                return r;
            }

            // 2) instalar
            Say("Instalando o driver PawnIO");
            var (exit, stuck) = Exec(setup, "-install -silent", 180000);
            r.exitCode = exit;
            Say(stuck ? "O instalador não terminou em 3 minutos e foi encerrado" : $"Instalador terminou (código {exit})");

            // 3) conferir (o driver pode levar alguns segundos para aparecer)
            Say("Conferindo o driver");
            for (int i = 0; i < 20 && state() != "ok"; i++) Thread.Sleep(500);
            r.state = state();
            if (r.state == "ok") { r.ok = true; Say("Driver funcionando"); return r; }

            var blocked = CodeIntegrityBlock(started);
            if (blocked != null) { r.reason = "blocked"; r.detail = blocked; }
            else if (stuck) { r.reason = "hung"; r.detail = "O instalador do PawnIO travou sem mostrar o motivo."; }
            else if (!DriverWasInstalled(started)) { r.reason = "notInstalled"; r.detail = $"O instalador terminou (código {exit}), mas o Windows não chegou a instalar o driver."; }
            else { r.reason = "failed"; r.detail = $"O driver foi instalado mas não carregou (código {exit}). Reinicie o PC: alguns drivers só carregam depois de reiniciar."; }
            Say(r.detail);
            return r;
        }
        catch (Exception e) { r.reason = "failed"; r.detail = e.Message; return r; }
        finally { r.log = log.ToArray(); }
    }

    // Remove a instalação anterior (o instalador recusa instalar por cima dela). false = algo ficou para trás.
    public static bool Cleanup(Action<string> say)
    {
        if (Registry.LocalMachine.OpenSubKey(UninstallKey) == null && !Directory.Exists(Dir)) return true;
        say("Removendo a instalação anterior do PawnIO");
        var un = Path.Combine(Dir, "uninstall.exe");
        if (File.Exists(un))
        {
            var (code, hung) = Exec(un, "-uninstall -silent", 60000);
            say(hung ? "O desinstalador travou e foi encerrado" : $"Desinstalador terminou (código {code})");
        }
        Exec("sc.exe", "stop PawnIO", 15000);
        Exec("sc.exe", "delete PawnIO", 15000);
        try { Registry.LocalMachine.DeleteSubKeyTree(UninstallKey, false); } catch (Exception e) { say("Registro: " + e.Message); }
        try { if (Directory.Exists(Dir)) Directory.Delete(Dir, true); } catch (Exception e) { say("Pasta: " + e.Message); }
        return Registry.LocalMachine.OpenSubKey(UninstallKey) == null && !Directory.Exists(Dir);
    }

    // O LibreHardwareMonitor lê a versão instalada do PawnIO uma vez só (propriedade estática). Depois de
    // instalar com o motor aberto, atualiza esse valor para os sensores da CPU usarem o driver sem reiniciar.
    public static void RefreshLhmVersion()
    {
        try
        {
            var t = typeof(LibreHardwareMonitor.Hardware.Computer).Assembly.GetType("LibreHardwareMonitor.PawnIo.PawnIo");
            var f = t?.GetField("<Version>k__BackingField", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            var v = Registry.LocalMachine.OpenSubKey(UninstallKey)?.GetValue("DisplayVersion") as string;
            if (f != null && Version.TryParse(v, out var ver)) f.SetValue(null, ver);
        }
        catch { /* versão diferente do LibreHardwareMonitor: a pessoa reinicia o motor */ }
    }

    // roda e espera; se passar do tempo, encerra (devolve hung = true)
    static (int code, bool hung) Exec(string file, string args, int timeoutMs)
    {
        using var p = Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = false, CreateNoWindow = true })!;
        if (p.WaitForExit(timeoutMs)) return (p.ExitCode, false);
        try { p.Kill(); } catch { /* já saiu */ }
        return (-1, true);
    }

    // "O Windows bloqueou o driver" (Integridade de memória, lista de drivers bloqueados, Smart App Control)
    static string? CodeIntegrityBlock(DateTime since)
    {
        try
        {
            var q = new EventLogQuery("Microsoft-Windows-CodeIntegrity/Operational", PathType.LogName,
                $"*[System[TimeCreated[@SystemTime>='{since.ToUniversalTime().AddMinutes(-1):o}']]]");
            using var reader = new EventLogReader(q);
            for (var e = reader.ReadEvent(); e != null; e = reader.ReadEvent())
            {
                string msg;
                try { msg = e.FormatDescription() ?? ""; } catch { msg = ""; }
                if (msg.IndexOf("pawn", StringComparison.OrdinalIgnoreCase) >= 0)
                    return "O Windows bloqueou o driver: " + msg.Split('\n')[0].Trim();
            }
        }
        catch { /* sem acesso ao log */ }
        return null;
    }

    // o Windows registra toda instalação de driver em setupapi.dev.log
    static bool DriverWasInstalled(DateTime since)
    {
        try
        {
            var f = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.Windows), "INF", "setupapi.dev.log");
            if (!File.Exists(f) || File.GetLastWriteTime(f) < since.AddMinutes(-1)) return false;
            using var s = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            s.Seek(Math.Max(0, s.Length - 2 * 1024 * 1024), SeekOrigin.Begin);
            using var rd = new StreamReader(s);
            return rd.ReadToEnd().IndexOf("pawnio", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { return false; }
    }
}
