using System.Globalization;

namespace InfoHardware.Core;

public static class Format
{
    static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");

    public static string Bytes(double bytes, int decimals = 1)
    {
        if (double.IsNaN(bytes) || bytes < 0) return "--";
        string[] units = ["B", "KB", "MB", "GB", "TB", "PB"];
        int i = 0;
        while (bytes >= 1024 && i < units.Length - 1) { bytes /= 1024; i++; }
        return bytes.ToString(i == 0 ? "0" : "0." + new string('0', decimals), Pt) + " " + units[i];
    }

    public static string Rate(double bytesPerSecond) =>
        double.IsNaN(bytesPerSecond) ? "--" : Bytes(bytesPerSecond) + "/s";

    public static string Num(double value, string format = "0") =>
        double.IsNaN(value) ? "--" : value.ToString(format, Pt);

    public static string Mhz(double mhz) =>
        double.IsNaN(mhz) ? "--" :
        mhz >= 10000 ? (mhz / 1000).ToString("0.0", Pt) + " GHz" :
        mhz >= 1000 ? (mhz / 1000).ToString("0.00", Pt) + " GHz" : mhz.ToString("0", Pt) + " MHz";

    public static string Uptime(TimeSpan t) =>
        t.TotalDays >= 1 ? $"{(int)t.TotalDays}d {t.Hours}h {t.Minutes}min" : $"{t.Hours}h {t.Minutes}min";
}
