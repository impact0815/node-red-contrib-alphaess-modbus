'use strict';
/**
 * Checks whether a context store name is configured in Node-RED's settings.js.
 * Node-RED silently falls back to the default store (usually memory) for an
 * unknown store name, so a typo or a missing contextStorage entry would make
 * the daily values non-persistent without any visible error.
 *
 * @param {string} name             store name selected in the node ('' = default)
 * @param {object} contextStorage   RED.settings.contextStorage (may be undefined)
 * @returns {boolean}
 */
function isStoreConfigured(name, contextStorage) {
	if (!name || name === 'default') return true;
	if (!contextStorage || typeof contextStorage !== 'object') {
		// without contextStorage Node-RED only provides the in-memory store
		return name === 'memory';
	}
	return Object.prototype.hasOwnProperty.call(contextStorage, name);
}

/** reads RED.settings.contextStorage without failing on older/stub runtimes */
function getContextStorage(RED) {
	try {
		return RED.settings ? RED.settings.contextStorage : undefined;
	} catch (err) {
		return undefined;
	}
}

module.exports = { isStoreConfigured, getContextStorage };
