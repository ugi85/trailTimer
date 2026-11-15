/**
 * TrailTimer - IndexedDB Database Module
 * Offline-first persistent storage for participants, timing logs (sync queue), and settings.
 */

const DB_NAME = 'TrailTimerDB';
const DB_VERSION = 1;

let dbInstance = null;

class TrailDB {
  static async open() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Object Store: Participants
        if (!db.objectStoreNames.contains('participants')) {
          const participantStore = db.createObjectStore('participants', { keyPath: 'bib' });
          participantStore.createIndex('category', 'category', { unique: false });
          participantStore.createIndex('status', 'status', { unique: false });
        }

        // Object Store: Timing Logs & Sync Queue
        if (!db.objectStoreNames.contains('timing_logs')) {
          const logStore = db.createObjectStore('timing_logs', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('sync_status', 'sync_status', { unique: false });
          logStore.createIndex('bib', 'bib', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Object Store: Settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- SETTINGS OPERATIONS ---
  static async getSetting(key, defaultValue = null) {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  }

  static async setSetting(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // --- PARTICIPANTS OPERATIONS ---
  static async getAllParticipants() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('participants', 'readonly');
      const store = tx.objectStore('participants');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async getParticipant(bib) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('participants', 'readonly');
      const store = tx.objectStore('participants');
      const req = store.get(String(bib));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async saveParticipant(participant) {
    const db = await this.open();
    let bib = String(participant.bib || '').trim();
    if (!bib && participant.name) {
      const match = String(participant.name).match(/^(\d+)\s*(.*)$/);
      if (match) {
        bib = match[1];
        participant.name = match[2];
      }
    }
    if (!bib) {
      bib = 'runner_' + Date.now();
    }
    participant.bib = bib;
    participant.updatedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('participants', 'readwrite');
      const store = tx.objectStore('participants');
      const req = store.put(participant);
      req.onsuccess = () => resolve(participant);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async saveParticipantsBatch(list) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('participants', 'readwrite');
      const store = tx.objectStore('participants');
      const now = new Date().toISOString();
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        let bib = String(item.bib || '').trim();
        if (!bib && item.name) {
          const match = String(item.name).match(/^(\d+)\s*(.*)$/);
          if (match) {
            bib = match[1];
            item.name = match[2];
          }
        }
        if (!bib) {
          bib = String(100 + i + 1);
        }
        item.bib = bib;
        item.updatedAt = now;
        store.put(item);
      }
      tx.oncomplete = () => resolve(list.length);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  static async deleteParticipant(bib) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('participants', 'readwrite');
      const store = tx.objectStore('participants');
      const req = store.delete(String(bib));
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async clearAllParticipants() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('participants', 'readwrite');
      const store = tx.objectStore('participants');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // --- TIMING LOGS & SYNC QUEUE OPERATIONS ---
  static async addTimingLog(log) {
    const db = await this.open();
    const entry = {
      ...log,
      bib: String(log.bib).trim(),
      sync_status: log.sync_status || 'pending',
      device_timestamp: log.device_timestamp || new Date().toISOString(),
      created_at: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('timing_logs', 'readwrite');
      const store = tx.objectStore('timing_logs');
      const req = store.add(entry);
      req.onsuccess = () => {
        entry.id = req.result;
        resolve(entry);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async getPendingLogs() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timing_logs', 'readonly');
      const store = tx.objectStore('timing_logs');
      const index = store.index('sync_status');
      const req = index.getAll('pending');
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async getPendingCount() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timing_logs', 'readonly');
      const store = tx.objectStore('timing_logs');
      const index = store.index('sync_status');
      const req = index.count('pending');
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async getAllTimingLogs() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timing_logs', 'readonly');
      const store = tx.objectStore('timing_logs');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  static async markLogsAsSynced(logIds) {
    if (!logIds || logIds.length === 0) return 0;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timing_logs', 'readwrite');
      const store = tx.objectStore('timing_logs');
      const syncedAt = new Date().toISOString();

      let count = 0;
      for (const id of logIds) {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          if (getReq.result) {
            const item = getReq.result;
            item.sync_status = 'synced';
            item.synced_at = syncedAt;
            store.put(item);
            count++;
          }
        };
      }

      tx.oncomplete = () => resolve(count);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  static async clearAllTimingLogs() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timing_logs', 'readwrite');
      const store = tx.objectStore('timing_logs');
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // --- FULL BACKUP & RESTORE ---
  static async exportFullBackup() {
    const participants = await this.getAllParticipants();
    const timing_logs = await this.getAllTimingLogs();
    
    // Get all settings
    const db = await this.open();
    const settings = await new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    return {
      version: '1.0',
      exported_at: new Date().toISOString(),
      settings,
      participants,
      timing_logs
    };
  }

  static async importFullBackup(backupData) {
    if (!backupData || !Array.isArray(backupData.participants)) {
      throw new Error('Format file cadangan tidak valid.');
    }

    const db = await this.open();

    // 1. Settings
    if (backupData.settings && Array.isArray(backupData.settings)) {
      const txSettings = db.transaction('settings', 'readwrite');
      const sStore = txSettings.objectStore('settings');
      for (const s of backupData.settings) {
        sStore.put(s);
      }
    }

    // 2. Participants
    const txPart = db.transaction('participants', 'readwrite');
    const pStore = txPart.objectStore('participants');
    for (const p of backupData.participants) {
      pStore.put(p);
    }

    // 3. Timing Logs
    if (backupData.timing_logs && Array.isArray(backupData.timing_logs)) {
      const txLogs = db.transaction('timing_logs', 'readwrite');
      const lStore = txLogs.objectStore('timing_logs');
      for (const log of backupData.timing_logs) {
        delete log.id; // Allow new auto-increment
        lStore.add(log);
      }
    }

    return true;
  }

  static async resetCategories() {
    const defaultCats = ['21K Trail', '10K Fun Trail', '50K Ultra'];
    await this.setSetting('categories', defaultCats);
    return defaultCats;
  }

  static async resetDatabase() {
    await this.clearAllParticipants();
    await this.clearAllTimingLogs();
    await this.resetCategories();
    return true;
  }
}

// Export to window
window.TrailDB = TrailDB;

