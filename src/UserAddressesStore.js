import ReduceStore from 'flux/lib/FluxReduceStore'
import dispatcher from './dispatcher'
import localStore from './localStore'
import { isEmpty, omit, pickBy, mapValues, uniqBy } from './utils'
import {
  ADD_ADDRESS_TAG,
  CLEAR_DATABASE,
  MARK_ALL_AS_DIRTY,
  MERGE_DATA,
  REMOVE_ADDRESS_TAG,
  REMOVE_ADDRESS,
  RESET_FROM_DATA,
  RESET_FROM_STORE,
  SYNC_CHANGES,
  UPDATE_DIRTY_STATUS,
  REPLACE_ADDRESS_TAGS_AND_NOTE,
} from './actions'
import appStore from './AppStore'
import userTagsStore from './UserTagsStore'

const INITIAL_STATE = {
  items: {},
  tmpRemoved: {},
}

class UserAddressesStore extends ReduceStore {

  get key () {
    return 'userAddresses'
  }

  get actions () {
    return {
      [ADD_ADDRESS_TAG]: this.handleAddAddressTag,
      [CLEAR_DATABASE]: this.handleClearDatabase,
      [MARK_ALL_AS_DIRTY]: this.handleMarkAllAsDirty,
      [MERGE_DATA]: this.handleMergeData,
      [REMOVE_ADDRESS_TAG]: this.handleRemoveAddressTag,
      [REMOVE_ADDRESS]: this.handleRemoveAddress,
      [REPLACE_ADDRESS_TAGS_AND_NOTE]: this.handleReplaceAddressTagsAndNote,
      [RESET_FROM_DATA]: this.handleResetFromData,
      [RESET_FROM_STORE]: this.handleResetFromStore,
      [SYNC_CHANGES]: this.handleSyncChanges,
      [UPDATE_DIRTY_STATUS]: this.handleUpdateDirtyStatus,
    }
  }

  createKey (data) {
    return String(data).toLowerCase()
  }

  getInitialState () {
    return localStore.store(this.key) || INITIAL_STATE
  }

  getStoreState () {
    const { items } = this.getState()
    return { items }
  }

  getExportJSON () {
    const state = this.getState()
    return {
      userAddresses: {
        items: Object.values(state.items)
          .filter(item => !item.removed)
          .map(item => ({
            address: item.address,
            addressTags: item.addressTags,
            addressUserNote: item.addressUserNote,
            createdTime: item.createdTime,
            updatedTime: item.updatedTime,
          }))
      }
    }
  }

  getItems () {
    const state = this.getState()
    return [].concat(
      Object.values(state?.items ?? {}).filter(item => !item.removed),
      Object.values(state?.tmpRemoved ?? {}),
    )
  }

  getAddressNote (address) {
    const state = this.getState()
    const data = state?.items?.[ this.createKey(address) ]
    return data && !data.removed && data.addressUserNote || ''
  }

  getAddressTags (address) {
    const state = this.getState()
    const data = state?.items?.[ this.createKey(address) ]
    return data && !data.removed && data.addressTags || []
  }

  getAllAddressTagsCount () {
    const state = this.getState()
    let cnt = 0
    for (const addr in state.items) {
      const data = state.items?.[addr]
      if (data && !data.removed) {
        cnt += 1
      }
    }
    return cnt
  }

  getChanges (/* timestamp */) {
    const state = this.getState()
    const remove = Object.values(
      mapValues(pickBy(state.items, item => item.removed), (item, address) => ({
        address,
      }))
    )
    const insert = Object.values(
      mapValues(pickBy(state.items, item => (
        item.dirty === 1 &&
        !item.removed
      )), item => ({
        address: item.address,
        addressTags: item.addressTags,
        addressUserNote: item.addressUserNote,
        createdTime: item.createdTime,
        updatedTime: item.updatedTime,
      }))
    )
    const update = Object.values(
      mapValues(pickBy(state.items, item => (
        item.dirty === 2 &&
        !item.removed
      )), item => ({
        address: item.address,
        addressTags: item.addressTags,
        addressUserNote: item.addressUserNote,
        createdTime: item.createdTime,
        updatedTime: item.updatedTime,
      }))
    )

    if (isEmpty(remove) && isEmpty(insert) && isEmpty(update)) {
      return
    }

    return {
      userAddress: {
        update,
        insert,
        remove,
      }
    }
  }

  reduce (state, action) {
    if (action.type && typeof this.actions[action.type] === 'function') {
      return this.actions[action.type](state, action)
    }

    return state
  }

  handleMergeData = (state, action) => {
    this.getDispatcher().waitFor([
      userTagsStore.getDispatchToken(),
    ])

    if (isEmpty(action?.payload?.userAddresses?.items)) {
      return state
    }

    const now = Date.now()
    const items = action.payload.userAddresses.items.reduce((out, item) => {
      const key = this.createKey(item.address)
      out[key] = {
        address: item.address,
        addressTags: uniqBy([].concat(
          state?.items?.[key]?.addressTags ?? [],
          item.addressTags,
        ), tag => userTagsStore.createKey(tag)),
        addressUserNote: item.addressUserNote,
        createdTime: item.createdTime || now,
        updatedTime: item.updatedTime || now,
        dirty: state?.items?.[key] ? 2 : 1,
      }
      return out
    }, {})

    return {
      ...state,
      tmpRemoved: omit(state?.tmpRemoved, Object.keys(items)),
      items: { ...state?.items, ...items },
    }
  }

  handleResetFromData = (state, action) => {
    this.getDispatcher().waitFor([
      appStore.getDispatchToken(),
    ])

    const data = action.payload

    if (data.userAddresses) {
      const now = Date.now()

      return {
        tmpRemoved: {},
        items: data.userAddresses.items.reduce((out, item) => {
          out[this.createKey(item.address)] = {
            address: item.address,
            addressTags: item.addressTags,
            addressUserNote: item.addressUserNote,
            createdTime: item.createdTime || now,
            updatedTime: item.updatedTime || now,
            dirty: 1,
          }
          return out
        }, {})
      }
    }

    return INITIAL_STATE
  }

  handleClearDatabase = () => {
    this.getDispatcher().waitFor([
      appStore.getDispatchToken(),
    ])

    return INITIAL_STATE
  }

  handleResetFromStore = () => {
    this.getDispatcher().waitFor([
      appStore.getDispatchToken(),
    ])

    return this.getInitialState()
  }

  handleRemoveAddressTag = (state, action) => {
    const now = Date.now()
    const data = action.payload
    const keyTag = userTagsStore.createKey(data.tag)
    const keyAddress = this.createKey(data.address)
    let prevData = state?.items?.[keyAddress]
    prevData = prevData && !prevData.removed ? prevData : undefined
    let addressTags = prevData?.addressTags ?? []
    addressTags = addressTags.filter(item => userTagsStore.createKey(item) !== keyTag)

    if (prevData && isEmpty(addressTags) && isEmpty(prevData.addressUserNote)) {
      const item = {
        createdTime: now,
        ...prevData,
        address: data.address,
        addressTags,
        removed: true,
        updatedTime: now,
      }

      return {
        ...state,
        tmpRemoved: { ...state?.tmpRemoved, [ keyAddress ]: item },
        items: prevData?.dirty === 1 ?
          omit(state.items, [ keyAddress ]) :
          { ...state?.items, [ keyAddress ]: item },
      }
    }

    const item = {
      createdTime: now,
      ...prevData,
      address: data.address,
      addressTags,
      dirty: prevData ? (prevData.dirty || 2) : 1,
      removed: false,
      updatedTime: now,
    }

    return {
      ...state,
      tmpRemoved: omit(state?.tmpRemoved, [ keyAddress ]),
      items: { ...state?.items, [ keyAddress ]: item },
    }
  }

  handleAddAddressTag = (state, action) => {
    this.getDispatcher().waitFor([
      userTagsStore.getDispatchToken(),
    ])

    const data = action.payload
    const keyTag = userTagsStore.createKey(data.tag)
    const keyAddress = this.createKey(data.address)
    let prevData = state?.items?.[keyAddress]
    prevData = prevData && !prevData.removed ? prevData : undefined
    const addressTags = prevData?.addressTags ?? []
    const now = Date.now()

    return {
      ...state,
      tmpRemoved: omit(state?.tmpRemoved, [ keyAddress ]),
      items: {
        ...state?.items,
        [ keyAddress ]: {
          createdTime: now,
          ...prevData,
          address: data.address,
          addressTags: addressTags.concat(data.tag),
          dirty: prevData ? (prevData.dirty || 2) : 1,
          removed: false,
          updatedTime: now,
        },
      },
    }
  }

  handleReplaceAddressTagsAndNote = (state, action) => {
    this.getDispatcher().waitFor([
      userTagsStore.getDispatchToken(),
    ])

    const data = action.payload
    const keyAddress = this.createKey(data.address)
    let prevData = state?.items?.[keyAddress]
    prevData = prevData && !prevData.removed ? prevData : undefined
    const addressTags = uniqBy(data.tags, item => userTagsStore.createKey(item))
    const now = Date.now()

    if (isEmpty(addressTags) && isEmpty(data.note)) {
      if (!prevData) {
        return state
      }

      const item = {
        createdTime: now,
        ...prevData,
        addressTags,
        addressUserNote: data.note,
        address: data.address,
        removed: true,
        updatedTime: now,
      }

      return {
        ...state,
        tmpRemoved: { ...state?.tmpRemoved, [ keyAddress ]: item },
        items: prevData?.dirty === 1 ?
          omit(state.items, [ keyAddress ]) :
          { ...state?.items, [ keyAddress ]: item },
      }
    }

    const item = {
      createdTime: now,
      ...prevData,
      addressTags,
      addressUserNote: data.note,
      address: data.address,
      dirty: prevData ? (prevData.dirty || 2) : 1,
      removed: false,
      updatedTime: now,
    }

    return {
      ...state,
      tmpRemoved: omit(state?.tmpRemoved, [ keyAddress ]),
      items: { ...state?.items, [ keyAddress ]: item },
    }
  }

  handleRemoveAddress = (state, action) => {
    const keyAddress = this.createKey(action.payload)
    const prevData = state?.items?.[keyAddress]
    const item = { ...prevData, removed: true }

    return {
      ...state,
      tmpRemoved: { ...state?.tmpRemoved, [ keyAddress ]: item },
      items: prevData?.dirty === 1 ?
        omit(state.items, [ keyAddress ]) :
        { ...state?.items, [ keyAddress ]: item },
    }
  }

  handleSyncChanges = (state, action) => {
    this.getDispatcher().waitFor([
      userTagsStore.getDispatchToken(),
    ])

    if (!action?.payload?.userAddress) {
      return state
    }

    const {
      created,
      updated,
      deleted,
      update,
      insert,
      remove,
    } = action.payload.userAddress

    if (!isEmpty(deleted) || !isEmpty(remove)) {
      const keys = (deleted || remove).map(item => this.createKey(item?.address ?? item))
      state = {
        ...state,
        items: omit(state.items, keys)
      }
    }

    const keys = [].concat(
      (created || insert)?.map?.(item => this.createKey(item.address)) ?? [],
      (updated || update)?.map?.(item => this.createKey(item.address)) ?? [],
    )

    state = {
      ...state,
      tmpRemoved: omit(state.tmpRemoved, keys),
      items: {
        ...state?.items,
        ...(created || insert)?.reduce?.((out, item) => Object.assign(out, { [ this.createKey(item.address) ]: item }), {}),
        ...(updated || update)?.reduce?.((out, item) => Object.assign(out, { [ this.createKey(item.address) ]: item }), {}),
      },
    }

    return state
  }

  handleMarkAllAsDirty = (state) => {
    const items = {}
    for (const key in state.items) {
      items[key] = {
        ...state.items[key],
        dirty: state.items[key]?.dirty ?? 1
      }
    }

    return {
      ...state,
      items,
    }
  }

  handleUpdateDirtyStatus = (state, action) => {
    const addresses = action?.payload?.addresses ?? []
    const from = action?.payload?.from
    const to = action?.payload?.to

    if (isEmpty(addresses) || !from || !to) {
      return state
    }

    const items = {}
    for (const key in state.items) {
      const dirty = state.items[key]?.dirty
      if (dirty === from && addresses.indexOf(key) !== -1) {
        items[key] = {
          ...state.items[key],
          dirty: to
        }
      } else {
        items[key] = state.items[key]
      }
    }

    return {
      ...state,
      items,
    }
  }

}

export default new UserAddressesStore(dispatcher)
