// lib/logger.ts
import fs from 'fs/promises';
import path from 'path';

interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: any;
}

class FileLogger {
    private logFilePath: string;
    private isServer: boolean;

    constructor() {
        this.isServer = typeof window === 'undefined';
        // Zapisz logi w katalogu logs w głównym katalogu projektu
        this.logFilePath = path.join(process.cwd(), 'logs', 'app.log');

        // Inicjalizacja pliku logów tylko po stronie serwera
        if (this.isServer) {
            this.initLogFile();
        }
    }

    private async initLogFile() {
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            await fs.mkdir(logsDir, { recursive: true });
        } catch (error) {
            console.error('Błąd tworzenia katalogu logs:', error);
        }
    }

    private async writeLog(entry: LogEntry) {
        if (!this.isServer) {
            // Na kliencie tylko loguj do konsoli
            console.log(JSON.stringify(entry, null, 2));
            return;
        }

        try {
            const logLine = JSON.stringify(entry) + '\n';
            await fs.appendFile(this.logFilePath, logLine, 'utf8');
        } catch (error) {
            console.error('Błąd zapisu logu:', error);
        }
    }

    info(message: string, data?: any) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'info',
            message,
            data
        };
        this.writeLog(entry);
    }

    warn(message: string, data?: any) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'warn',
            message,
            data
        };
        this.writeLog(entry);
    }

    error(message: string, data?: any) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level: 'error',
            message,
            data
        };
        this.writeLog(entry);
    }

    debug(message: string, data?: any) {
        if (process.env.NODE_ENV === 'development') {
            const entry: LogEntry = {
                timestamp: new Date().toISOString(),
                level: 'debug',
                message,
                data
            };
            this.writeLog(entry);
        }
    }
}

// Singleton
const logger = new FileLogger();
export default logger;