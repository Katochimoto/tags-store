import 'unfetch/polyfill'
import PQueue from 'p-queue'
import { debounce, isEmpty, cloneDeepWith, omit } from './utils'
import localStore from './localStore'
import appStore from './AppStore'
import userTxsStore from './UserTxsStore'
import userTagsStore from './UserTagsStore'
import userAddressesStore from './UserAddressesStore'
import * as actions from './actions'

const queue = new PQueue({
  concurrency: 1,
})

const requestOptions = {
  mode: 'cors',
  cache: 'no-cache',
  credentials: 'same-origin',
  redirect: 'follow',
  referrer: 'no-referrer',
}

const OPTIONS = {
  onSync: undefined,
  syncApi: undefined,
  syncUserApi: undefined,
  accessTagsNotes: false,
}

const syncChangesLazy = debounce(syncChangesQueue, 500)

export function syncChangesQueue () {
  queue.clear()
  return queue.add(() => {
    OPTIONS.onSync?.(null, true)
    return remoteSyncChanges()
      .then((data) => {
        actions.boundUpdateLastSyncCall()
        OPTIONS.onSync?.(null, false)
      })
      .catch(error => {
        actions.boundUpdateLastSyncCall()
        OPTIONS.onSync?.(error || new Error('Remote sync error'), false)
        return Promise.reject(error)
      })
  })
}

export function syncChanges (renewalOnly = false, cacheCall = false) {
  if (OPTIONS.syncApi && OPTIONS.syncUserApi && appStore.canPushChanges()) {
    if (
      !renewalOnly ||
      (renewalOnly && appStore.getLastSyncedAt() > 1)
    ) {
      if (
        !cacheCall ||
        (Date.now() - appStore.getLastSyncCall()) > cacheCall
      ) {
        syncChangesLazy()
      }
    }
  } else {
    syncChangesLazy.cancel()
  }
}

function handleVisibilitychange (event) {
  if (document.hidden) {
    clearTimeout(syncChanges.retryTimeout)
    syncChanges.retryTimeout = 0
  } else if (!syncChanges.retryTimeout) {
    if (event) {
      syncChanges.retryCount = 0
    }

    const timeout = (
      syncChanges.retryIntervals[ syncChanges.retryCount ] ||
      syncChanges.retryIntervals[ syncChanges.retryIntervals.length - 1 ]
    )

    syncChanges.retryTimeout = setTimeout(() => {
      syncChanges(true)
      syncChanges.retryCount++
      syncChanges.retryTimeout = 0
      handleVisibilitychange()
    }, timeout)
  }
}

syncChanges.retryTimeout = 0
syncChanges.retryCount = 0
syncChanges.retryIntervals = [ 10 * 1000, 60 * 1000, 2 * 60 * 1000 ]

syncChanges.stop = () => {
  document.removeEventListener('visibilitychange', handleVisibilitychange, false)
  clearTimeout(syncChanges.retryTimeout)
  syncChanges.retryTimeout = 0
}

syncChanges.start = () => {
  syncChanges.stop()
  handleVisibilitychange()
  document.addEventListener('visibilitychange', handleVisibilitychange, false)
}

export function syncOptions (options) {
  OPTIONS.onSync = options?.onSync
  OPTIONS.syncApi = options?.syncApi
  OPTIONS.syncUserApi = options?.syncUserApi
  OPTIONS.accessTagsNotes = options?.accessTagsNotes ?? false
}

function userInit () {
  const userId = localStore.userId()
  return fetch(`${OPTIONS.syncUserApi}/${userId}`, { ...requestOptions, method: 'PUT' })
    .then(response => (response.ok ? response.json() : Promise.reject()))
}

function remoteSyncChanges (updateAfterConflict = true) {
  return userInit()
    .then(user => {
      actions.boundUpdateNotificationChannels(user.notificationChannels)
      const timestamp = appStore.getLastSyncedAt()
      return fetch(`${OPTIONS.syncApi}/${user.idUser}/${timestamp}`, { ...requestOptions, method: 'GET' })
        .then(response => (response.ok ? response.json() : Promise.reject()))
        .then(data => (data && Object.hasOwnProperty.call(data, 'lastSyncedAt') ? data : Promise.reject()))
        .then(({ lastSyncedAt, changes }) => {
          lastSyncedAt = lastSyncedAt || 1
          if (lastSyncedAt < timestamp) {
            actions.boundMarkAllAsDirty()
          }
          actions.boundSyncChanges(changes)
          actions.boundUpdateLastSyncTime(lastSyncedAt)
        })
        .then(() => {
          if (!appStore.canPushChanges()) {
            return Promise.resolve()
          }

          const localChanges = {
            ...(OPTIONS.accessTagsNotes && appStore.canSyncTagsAndNotes() ? {
              ...userTxsStore.getChanges(),
              ...userTagsStore.getChanges(),
              ...userAddressesStore.getChanges(),
            } : {})
          }

          if (isEmpty(localChanges)) {
            return Promise.resolve()
          }

          const body = JSON.stringify(cloneDeepWith(localChanges, (item) => {
            if (
              typeof item === 'object' &&
              item !== null &&
              !Array.isArray(item) &&
              (item.updatedTime || item.createdTime)
             ) {
              return {
                ...omit(item, [ 'updatedTime', 'createdTime' ]),
                clientCreatedTime: item.createdTime,
                clientUpdatedTime: item.updatedTime,
              }
            }
          }))

          const timestamp = appStore.getLastSyncedAt()
          return fetch(`${OPTIONS.syncApi}/${user.idUser}/${timestamp}`, {
              ...requestOptions,
              method: 'POST',
              body,
            })
            .then(response => {
              if (response.status === 409) {
                if (updateAfterConflict) {
                  return Promise.resolve(response.json())
                    .then(data => {
                      const collection = data?.info?.collection
                      const shouldNotExists = data?.info?.shouldNotExists
                      if (collection && !isEmpty(shouldNotExists)) {
                        actions.boundUpdateDirtyStatus(1, 2, {
                          ...(collection === 'userAddress' ? {
                            addresses: shouldNotExists
                          } : {}),
                          ...(collection === 'userTag' ? {
                            tags: shouldNotExists
                          } : {}),
                          ...(collection === 'userTx' ? {
                            txs: shouldNotExists
                          } : {}),
                        })
                      }

                      return remoteSyncChanges(false)
                    })
                } else {
                  return Promise.reject()
                }
              }

              if (response.status === 412) {
                if (updateAfterConflict) {
                  actions.boundClearDatabase()
                  return remoteSyncChanges(false)
                } else {
                  return Promise.reject()
                }
              }

              if (!response.ok) {
                return Promise.reject()
              }

              return response.json()
            })
            .then(data => (data && Object.hasOwnProperty.call(data, 'lastSyncedAt') ? data : Promise.reject()))
            .then(({ lastSyncedAt, changes }) => {
              lastSyncedAt = lastSyncedAt || 1
              actions.boundSyncChanges(localChanges)
              actions.boundSyncChanges(changes)
              actions.boundUpdateLastSyncTime(lastSyncedAt)
            })
        })
    })
}
