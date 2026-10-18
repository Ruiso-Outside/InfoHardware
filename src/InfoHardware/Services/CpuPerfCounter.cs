using System.Diagnostics;
using System.Management;

namespace InfoHardware.Services;

/// <summary>
/// Clock efetivo da CPU estimado pelo Windows (clock base × "% Processor Performance"),
/// usado quando o LibreHardwareMonitor não consegue ler os clocks por núcleo.
/// </summary>
sealed class CpuPerfCounter
{
    PerformanceCounter? _counter;
    double _baseMhz;
    bool _failed;

    public double? ReadMhz()
    {
        if (_failed) return null;
        try
        {
            if (_counter == null)
            {
                using var s = new ManagementObjectSearcher("SELECT MaxClockSpeed FROM Win32_Processor");
                _baseMhz = s.Get().Cast<ManagementBaseObject>().Select(o => Convert.ToDouble(o["MaxClockSpeed"])).FirstOrDefault();
                _counter = new PerformanceCounter("Processor Information", "% Processor Performance", "_Total", true);
                _counter.NextValue(); // a primeira leitura é sempre 0
                return null;
            }
            var pct = _counter.NextValue();
            return pct > 0 && _baseMhz > 0 ? _baseMhz * pct / 100 : null;
        }
        catch
        {
            _failed = true;
            return null;
        }
    }
}
