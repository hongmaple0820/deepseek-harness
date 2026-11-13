/**
 * Host routes the portable user-data bundle serves.
 * @module @deepseek-ai/dsh-user-data-backup/routes
 */

/** Download one assembled bundle. */
export const USER_DATA_EXPORT_PATH = '/api/user-data.export'

/** Report what a bundle would change without writing it. */
export const USER_DATA_IMPORT_PREVIEW_PATH = '/api/user-data.import.preview'

/** Apply a bundle. */
export const USER_DATA_IMPORT_PATH = '/api/user-data.import'

/** List the configured remotes. */
export const USER_DATA_REMOTES_PATH = '/api/user-data.remotes'

/** Add or replace a remote the settings page manages. */
export const USER_DATA_REMOTES_SAVE_PATH = '/api/user-data.remotes.save'

/** Remove a remote the settings page added. */
export const USER_DATA_REMOTES_DELETE_PATH = '/api/user-data.remotes.delete'

/** Probe a remote with one listing request. */
export const USER_DATA_REMOTES_TEST_PATH = '/api/user-data.remotes.test'

/** Upload a fresh bundle to a remote. */
export const USER_DATA_SYNC_PUSH_PATH = '/api/user-data.sync.push'

/** List the bundles stored on a remote. */
export const USER_DATA_SYNC_LIST_PATH = '/api/user-data.sync.list'

/** Read one stored bundle so the client can preview and apply it. */
export const USER_DATA_SYNC_BUNDLE_PATH = '/api/user-data.sync.bundle'
