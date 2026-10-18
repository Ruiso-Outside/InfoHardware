using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace InfoHardware.Core;

public sealed class InverseBoolToVisConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value is true ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Converte um valor de enum/string em bool para RadioButtons (ConverterParameter = opção).</summary>
public sealed class EqualsConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        string.Equals(value?.ToString(), parameter?.ToString(), StringComparison.OrdinalIgnoreCase);

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is not true) return Binding.DoNothing;
        var p = parameter?.ToString() ?? "";
        if (targetType == typeof(int) && int.TryParse(p, out var i)) return i;
        return p;
    }
}
