# BackDimmer

A background-only dimming tool for focused work. Creates a transparent overlay that stays behind all windows to reduce eye strain without blocking visibility.

## ✨ Features

- **Non-intrusive overlay** - Dims background without stealing focus from active windows
- **Always-on-bottom** - Stays behind all other windows automatically
- **Persistent positioning** - Monitor-geometry aware, adapts to display configuration
- **Configurable** - Adjust transparency and color via ini file
- **System tray integration** - Easy access to reload, edit config, or exit

## 🚀 Getting Started

### Prerequisites

- Windows OS
- [AutoHotkey v2.0](https://www.autohotkey.com/v2/) or later

### Installation

1. Install AutoHotkey v2
2. Download or clone this repository
3. Run `BackDimmer.ahk` (double-click or execute with AutoHotkey)

### Compiled Executable

A pre-compiled `BackDimmer.exe` is included for convenience. Run it directly without AutoHotkey installed.

## ⚙️ Configuration

BackDimmer creates a `BackDimmer.ini` file in its directory on first launch.

### Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `backcolor` | `000000` | Overlay background color (hex RGB) |
| `transparency` | `180` | Transparency level (0-255, where 0 is fully transparent) |

### Editing Config

Right-click the tray icon and select **Edit Config** to modify settings, then select **Reload Script** to apply changes.

### Example Configuration

```ini
[Settings]
backcolor=000000
transparency=180
version=v1.0.0
```

## 📖 Usage

Once running, BackDimmer runs silently in the background:

- Tray icon shows running status
- Overlay appears on all monitors
- Active windows remain fully interactive on top

### Tray Menu Options

- **BackDimmer v1.0.0** - Version indicator (disabled)
- **Edit Config** - Open ini file for editing
- **Reload Script** - Reload with new settings
- **Exit** - Stop BackDimmer

## 🏗️ Building from Source

Compile the script to executable using Ahk2Exe:

```ahk
; Compiler directives (included in source)
;@Ahk2Exe-SetName BackDimmer
;@Ahk2Exe-SetVersion 1.0.0
;@Ahk2Exe-SetDescription BackDimmer - Background dimming tool
;@Ahk2Exe-SetCompanyName vhxubo.com
```

## 📝 Technical Details

- **Single-instance** - Forces single execution
- **Monitor-geometry aware** - Calculates screen bounds dynamically
- **DPI scaling** - Uses 1.5x oversized overlay to eliminate scaling gaps
- **Window positioning** - HWND_BOTTOM ensures permanent background placement
- **No-activate flag** - Prevents focus stealing

## 📄 License

Personal-use tool. Feel free to study and adapt.

---

**Version**: v1.0.0  
**Author**: vhxubo
