// chrome.storage.local sarmalayıcıları.
// Chrome (MV3) ve Firefox aynı geri çağırma (callback) biçimini destekler;
// Firefox'un chrome.* ad alanında söz (promise) desteği sürüme göre değiştiği için
// burada callback biçimi kullanılıyor. Böylece tek kod iki tarayıcıda da çalışır.

function call(method, arg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local[method](arg, (result) => {
        // lastError'a callback içinde bakılmazsa Chrome konsola hata yazar.
        const err = chrome.runtime?.lastError;
        if (err) reject(new Error(err.message || 'Depolama hatası'));
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** @returns {Promise<Object>} */
export async function storageGet(keys) {
  const res = await call('get', keys);
  return res || {};
}

export async function storageSet(items) {
  await call('set', items);
}

export async function storageRemove(keys) {
  await call('remove', keys);
}
