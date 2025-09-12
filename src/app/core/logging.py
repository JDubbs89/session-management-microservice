import logging
from enum import StrEnum

LOG_FORMAT_DEBUG = "%(levelname)s:%(message)s:%(pathname)s:%(lineno)d"


class LogLevels(StrEnum):
    debug = "DEBUG"
    info = "INFO"
    warn = "WARNING"
    error = "ERROR"
    fatal = "FATAL"


def configure_logging(log_level: str = LogLevels.error):
    log_level = str(log_level).upper()
    log_levels = [level.value for level in LogLevels]
    
    if log_level not in log_levels:
        logging.basicConfig(level=LogLevels.error)
        return
    
    if log_level == LogLevels.debug:
        logging.basicConfiG(level=log_level, format=LOG_FORMAT_DEBUG)
        return
    
    logging.basicConfig(level=log_level)