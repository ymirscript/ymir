/**
 * A utility class for logging message to the console for the compilation process.
 */
export class Logger {

    public static info(message: string, ...args: unknown[]) {
        Logger.log(LogLevel.Info, message, ...args);
    }

    public static warning(message: string, ...args: unknown[]) {
        Logger.log(LogLevel.Warning, message, ...args);
    }

    public static error(message: string, ...args: unknown[]) {
        Logger.log(LogLevel.Error, message, ...args);
    }

    public static success(message: string, ...args: unknown[]) {
        Logger.log(LogLevel.Success, message, ...args);
    }

    public static log(level: LogLevel, message: string, ...args: unknown[]) {
        const [prefix, prefixStyle] = Logger.getLogLevelData(level);
        const template = `%c${prefix}\t%c ${message}`;
        console.log(template, `color: ${prefixStyle}`, 'color: gray', ...args);
    }

    private static getLogLevelData(level: LogLevel) {
        switch (level) {
            case LogLevel.Info:
                return ['INFO', 'blue'];
            case LogLevel.Warning:
                return ['WARNING', 'orange'];
            case LogLevel.Error:
                return ['ERROR', 'red'];
            case LogLevel.Success:
                return ['SUCCESS', 'green'];
        }
    }
}

/**
 * The level of logging.
 */
export enum LogLevel {
    Info,
    Warning,
    Error,
    Success
}