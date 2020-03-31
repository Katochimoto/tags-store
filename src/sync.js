import 'unfetch/polyfill'
import PQueue from 'p-queue'
import { debounce, isEmpty, cloneDeepWith } from './utils'
import localStore from './localStore'
import appStore from './AppStore'
import * as actions from './actions'

const queue = new PQueue({
  concurrency: 1,
})

const syncChangesLazy = debounce(() => {
  queue.clear()
  queue.add(() => remoteSyncChanges())
}, 500)

const requestOptions = {
  mode: 'cors',
  cache: 'no-cache',
  credentials: 'same-origin',
  redirect: 'follow',
  referrer: 'no-referrer',
}

const OPTIONS = {
  syncApi: undefined,
  syncUserApi: undefined,
  accessTagsNotes: false,
}

export function syncChanges (renewalOnly = false) {
  if (OPTIONS.syncApi && OPTIONS.syncUserApi && appStore.canPushChanges()) {
    if (
      !renewalOnly ||
      (renewalOnly && appStore.getLastSyncedAt() > 1)
    ) {
      syncChangesLazy()
    }
  } else {
    syncChangesLazy.cancel()
  }
}

export function syncOptions (options) {
  OPTIONS.syncApi = options?.syncApi
  OPTIONS.syncUserApi = options?.syncUserApi
  OPTIONS.accessTagsNotes = options?.accessTagsNotes ?? false
}

function userInit () {
  const userId = localStore.userId()
  return fetch(`${syncUserApi}/${userId}`, { ...requestOptions, method: 'PUT' })
    .then(response => (response.ok ? response.json() : Promise.reject()))
}

function remoteSyncChanges (updateAfterConflict = true) {
  return userInit()
    .then(user => {
      const timestamp = appStore.getLastSyncedAt()
      return fetch(`${syncApi}/${user.idUser}/${timestamp}`, { ...requestOptions, method: 'GET' })
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
              return omit(item, [ 'updatedTime', 'createdTime' ])
            }
          }))

          const timestamp = appStore.getLastSyncedAt()
          return fetch(`${syncApi}/${user.idUser}/${timestamp}`, {
              ...requestOptions,
              method: 'POST',
              body,
            })
            .then(response => {
              if (response.status === 409) {
                if (updateAfterConflict) {
                  return Promise.resolve(response.json())
                    .then(data => {
                      const collection = data?.info?.details?.collection
                      const shouldNotExists = data?.info?.details?.shouldNotExists
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
