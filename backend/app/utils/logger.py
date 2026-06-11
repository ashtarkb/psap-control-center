import os
from datetime import datetime
from enum import IntEnum
import traceback
import json
import sys


class LogLevel(IntEnum):
    ERROR = 0
    WARN = 1
    INFO = 2
    DEBUG = 3


_current_level = LogLevel.INFO

LOG_LEVEL_NAMES = {
    LogLevel.ERROR: "ERROR",
    LogLevel.WARN: "WARN",
    LogLevel.INFO: "INFO",
    LogLevel.DEBUG: "DEBUG",
}


def _format_datetime():
    now = datetime.now()
    ms = f"{now.microsecond // 1000:03d}"
    return now.strftime("%Y-%m-%d %H:%M:%S.") + ms


def _format_arg(arg):
    if isinstance(arg, Exception):
        exc_info = traceback.format_exception(
            type(arg), arg, arg.__traceback__
        )
        return "".join(exc_info)
    if isinstance(arg, (dict, list)):
        try:
            return json.dumps(arg, indent=2, default=str)
        except (TypeError, ValueError):
            return str(arg)
    return str(arg)


def _format_message(context, level, message, args):
    datetime_str = _format_datetime()
    level_name = LOG_LEVEL_NAMES[level]

    if args:
        args_str = " ".join(_format_arg(a) for a in args)
        message = f"{message} {args_str}"

    return f"{datetime_str} {context}: {level_name} - {message}"


class Logger:
    def __init__(self, context: str):
        self.context = context

    def error(self, message: str, *args):
        if _current_level >= LogLevel.ERROR:
            output = _format_message(
                self.context, LogLevel.ERROR, message, args
            )
            print(output, file=sys.stderr, flush=True)

    def warn(self, message: str, *args):
        if _current_level >= LogLevel.WARN:
            output = _format_message(
                self.context, LogLevel.WARN, message, args
            )
            print(output, file=sys.stderr, flush=True)

    warning = warn

    def info(self, message: str, *args):
        if _current_level >= LogLevel.INFO:
            output = _format_message(self.context, LogLevel.INFO, message, args)
            print(output, flush=True)

    def debug(self, message: str, *args):
        if _current_level >= LogLevel.DEBUG:
            output = _format_message(self.context, LogLevel.DEBUG, message, args)
            print(output, flush=True)


def create_logger(context: str) -> Logger:
    return Logger(context)


def set_log_level(level: LogLevel):
    global _current_level  # noqa: PLW0603
    _current_level = level


def set_log_level_from_env():
    global _current_level  # noqa: PLW0603
    env_level = os.environ.get("LOG_LEVEL", "").upper()
    level_map = {
        "ERROR": LogLevel.ERROR,
        "WARN": LogLevel.WARN,
        "INFO": LogLevel.INFO,
        "DEBUG": LogLevel.DEBUG
    }
    if env_level in level_map:
        _current_level = level_map[env_level]
