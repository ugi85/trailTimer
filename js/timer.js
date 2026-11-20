/**
 * TrailTimer - Core Timing & Calculation Engine
 * Accurate timing calculated from absolute timestamps (Date.now() - startTimestamp)
 * Resistant to phone sleep/screen-off time drift.
 */

class TrailTimer {
  /**
   * Format milliseconds into HH:MM:SS (or HH:MM:SS.d)
   */
  static formatElapsed(ms, showTenths = false) {
    if (ms === null || ms === undefined || isNaN(ms) || ms < 0) {
      return '--:--:--';
    }

    const totalSeconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num) => String(num).padStart(2, '0');

    const base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return showTenths ? `${base}.${tenths}` : base;
  }

  /**
   * Format epoch timestamp to local time string (HH:MM:SS)
   */
  static formatTimeOfDay(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * Bersihkan tampilan waktu / split agar murni HH:MM:SS atau MM:SS tanpa tanggal 1899 atau teks GMT / Timezone
   */
  static cleanTimeDisplay(val, fallbackMs) {
    if (fallbackMs !== null && fallbackMs !== undefined && !isNaN(fallbackMs) && fallbackMs >= 0) {
      return this.formatElapsed(fallbackMs);
    }
    if (val === null || val === undefined) return '-';
    if (typeof val === 'number') return this.formatElapsed(val);
    const s = String(val).trim();
    if (!s || s === '-' || s === '--:--:--') return '-';
    const match = s.match(/(\d{1,2}:\d{2}:\d{2})/);
    if (match) return match[1];
    const shortMatch = s.match(/(\d{1,2}:\d{2})/);
    if (shortMatch) return shortMatch[1];
    return s.replace(/GMT.*$/i, '').trim();
  }

  /**
   * Format seconds-per-km to MM:SS /km (Pace)
   */
  static formatPace(paceSecPerKm) {
    if (!paceSecPerKm || !isFinite(paceSecPerKm) || paceSecPerKm <= 0 || paceSecPerKm > 3600) {
      return '--:-- /km';
    }
    const mins = Math.floor(paceSecPerKm / 60);
    const secs = Math.floor(paceSecPerKm % 60);
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(mins)}:${pad(secs)} /km`;
  }

  /**
   * Format speed to X.X km/h
   */
  static formatSpeed(speedKmh) {
    if (!speedKmh || !isFinite(speedKmh) || speedKmh <= 0) {
      return '-- km/h';
    }
    return `${speedKmh.toFixed(1)} km/h`;
  }

  /**
   * Calculate split metrics between two timestamps
   * @param {number} prevTimestamp - Start or previous checkpoint timestamp in ms
   * @param {number} currTimestamp - Current checkpoint timestamp in ms
   * @param {number} segmentDistKm - Distance between the two points in KM
   */
  static calculateSplit(prevTimestamp, currTimestamp, segmentDistKm) {
    const splitMs = Math.max(0, currTimestamp - prevTimestamp);
    const splitHours = splitMs / 3600000;
    const splitSecs = splitMs / 1000;

    let speedKmh = 0;
    let paceSecPerKm = 0;

    if (segmentDistKm > 0 && splitHours > 0) {
      speedKmh = segmentDistKm / splitHours;
      paceSecPerKm = splitSecs / segmentDistKm;
    }

    return {
      splitMs,
      splitFormatted: this.formatElapsed(splitMs),
      speedKmh,
      speedFormatted: this.formatSpeed(speedKmh),
      paceSecPerKm,
      paceFormatted: this.formatPace(paceSecPerKm)
    };
  }

  /**
   * Calculate overall pace and speed from totalMs and totalDistanceKm
   */
  static calculateOverall(totalMs, totalDistanceKm) {
    const hours = totalMs / 3600000;
    const secs = totalMs / 1000;

    let speedKmh = 0;
    let paceSecPerKm = 0;

    if (totalDistanceKm > 0 && hours > 0) {
      speedKmh = totalDistanceKm / hours;
      paceSecPerKm = secs / totalDistanceKm;
    }

    return {
      totalFormatted: this.formatElapsed(totalMs),
      speedKmh,
      speedFormatted: this.formatSpeed(speedKmh),
      paceSecPerKm,
      paceFormatted: this.formatPace(paceSecPerKm)
    };
  }

  /**
   * Global Timer Ticker for updating active running timers in UI.
   * Runs every 500ms with low CPU/battery consumption.
   */
  static startTicker(updateCallback) {
    if (this._tickerId) {
      clearInterval(this._tickerId);
    }
    this._tickerId = setInterval(() => {
      if (typeof updateCallback === 'function') {
        updateCallback();
      }
    }, 500);
  }

  static stopTicker() {
    if (this._tickerId) {
      clearInterval(this._tickerId);
      this._tickerId = null;
    }
  }
}

// Export to window
window.TrailTimer = TrailTimer;

