"""واجهة التيرمنال | Pretty terminal output: startup banner, step lines, status panel.
بدون مكتبات خارجية. يحترم NO_COLOR وغير التيرمنال (يطبع نصاً عادياً)."""
import logging
import os
import sys
import time

_USE = sys.stdout.isatty() and not os.environ.get("NO_COLOR") or os.environ.get("FORCE_COLOR")
if os.name == "nt":
    os.system("")  # يفعّل ألوان ANSI في ويندوز


def c(text, *codes) -> str:
    return f"\033[{';'.join(codes)}m{text}\033[0m" if _USE else str(text)


BLUE, CYAN, GREEN, YELLOW, RED, MAG, GRAY, BOLD, DIM = "38;5;75", "38;5;51", "38;5;48", "38;5;220", "38;5;203", "38;5;141", "38;5;245", "1", "2"
LOGO = [
    r"██████╗ ███████╗██╗   ██╗██╗██╗   ██╗███████╗",
    r"██╔══██╗██╔════╝██║   ██║██║██║   ██║██╔════╝",
    r"██████╔╝█████╗  ██║   ██║██║██║   ██║█████╗  ",
    r"██╔══██╗██╔══╝  ╚██╗ ██╔╝██║╚██╗ ██╔╝██╔══╝  ",
    r"██║  ██║███████╗ ╚████╔╝ ██║ ╚████╔╝ ███████╗",
    r"╚═╝  ╚═╝╚══════╝  ╚═══╝  ╚═╝  ╚═══╝  ╚══════╝",
]
GRADIENT = ["38;5;27", "38;5;33", "38;5;39", "38;5;45", "38;5;51", "38;5;87"]
T0 = time.time()
WIDTH = 64


def banner(version: str = "") -> None:
    print()
    for i, line in enumerate(LOGO):
        print("  " + c(line, GRADIENT[i], BOLD))
    sub = f"Discord bot + dashboard · {version}" if version else "Discord bot + dashboard"
    print("  " + c(sub, GRAY) + "\n")


def section(title: str) -> None:
    print("\n  " + c("▍", BLUE, BOLD) + " " + c(title.upper(), BOLD) + " " + c("─" * max(2, WIDTH - len(title) - 4), GRAY))


def ok(label: str, detail: str = "") -> None:
    print(f"  {c('✔', GREEN, BOLD)} {c(label.ljust(26), BOLD)}{c(detail, GRAY)}")


def warn(label: str, detail: str = "") -> None:
    print(f"  {c('▲', YELLOW, BOLD)} {c(label.ljust(26), YELLOW)}{c(detail, GRAY)}")


def fail(label: str, detail: str = "") -> None:
    print(f"  {c('✖', RED, BOLD)} {c(label.ljust(26), RED)}{c(detail, GRAY)}")


def info(label: str, detail: str = "") -> None:
    print(f"  {c('•', CYAN)} {label.ljust(26)}{c(detail, GRAY)}")


def bar(done: int, total: int, width: int = 24) -> str:
    n = int(width * done / total) if total else width
    return c("█" * n, GREEN) + c("░" * (width - n), GRAY) + f" {done}/{total}"


def panel(rows: list[tuple[str, str]], title: str = "") -> None:
    w = max(len(k) for k, _ in rows) + 2
    inner = WIDTH
    print("\n  " + c("╭" + "─" * inner + "╮", BLUE))
    if title:
        print("  " + c("│", BLUE) + " " + c(title.center(inner - 2), BOLD, CYAN) + " " + c("│", BLUE))
        print("  " + c("├" + "─" * inner + "┤", BLUE))
    for k, v in rows:
        pad = inner - len(f" {k:<{w}}{v}")
        print("  " + c("│", BLUE) + c(f" {k:<{w}}", GRAY) + c(str(v), BOLD) + " " * max(0, pad) + c("│", BLUE))
    print("  " + c("╰" + "─" * inner + "╯", BLUE) + "\n")


def memory_mb() -> float:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS"):
                    return int(line.split()[1]) / 1024
    except OSError:
        pass
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 if sys.platform != "darwin" else 1024 * 1024)
    except Exception:
        return 0.0


def uptime() -> str:
    s = int(time.time() - T0)
    return f"{s // 60}m {s % 60}s" if s >= 60 else f"{s}s"


class Pretty(logging.Formatter):
    LV = {"DEBUG": GRAY, "INFO": CYAN, "WARNING": YELLOW, "ERROR": RED, "CRITICAL": RED}

    def format(self, r: logging.LogRecord) -> str:
        t = time.strftime("%H:%M:%S", time.localtime(r.created))
        lv = c(f"{r.levelname[:4]:<4}", self.LV.get(r.levelname, GRAY), BOLD)
        msg = r.getMessage()
        if r.exc_info:
            msg += "\n" + self.formatException(r.exc_info)
        return f"  {c(t, GRAY)} {lv} {c(r.name.split('.')[-1][:10], MAG):<10} {msg}"


def setup_logging() -> None:
    h = logging.StreamHandler()
    h.setFormatter(Pretty())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(logging.INFO)
    for noisy in ("discord.gateway", "discord.client", "discord.http", "discord.state", "aiohttp", "uvicorn", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
