import ReduceStore from 'flux/lib/FluxReduceStore'
import dispatcher from './dispatcher'
import localStore from './localStore'
import {
  CLEAR_DATABASE,
  RESET_FROM_DATA,
  RESET_FROM_STORE,
  TOGGLE_PUSH_CHANGES,
  TOGGLE_SHOW_DIALOG_HELP,
  TOGGLE_SYNC_TAGS_AND_NOTES,
  UPDATE_LAST_SYNC_TIME,
} from './actions'

class AppStore extends ReduceStore {

  get key () {
    return 'app'
  }

  get actions () {
    return {
      [CLEAR_DATABASE]: this.handleClearDatabase,
      [RESET_FROM_DATA]: this.handleResetFromData,
      [RESET_FROM_STORE]: this.handleResetFromStore,
      [TOGGLE_PUSH_CHANGES]: this.handleTogglePushChanges,
      [TOGGLE_SHOW_DIALOG_HELP]: this.handleToggleShowDialogHelp,
      [TOGGLE_SYNC_TAGS_AND_NOTES]: this.handleToggleSyncTagsAndNotes,
      [UPDATE_LAST_SYNC_TIME]: this.handleUpdateLastSyncTime,
    }
  }

  getInitialState () {
    const state = {
      ...localStore.store(this.key)
    }

    if (state.showDialogHelp === undefined) {
      state.showDialogHelp = true
    }

    if (state.pushChanges === undefined) {
      state.pushChanges = true
    }

    if (state.lastSyncedAt === undefined) {
      state.lastSyncedAt = 1
    }

    if (state.syncTagsAndNotes === undefined) {
      state.syncTagsAndNotes = true
    }

    return state
  }

  canSyncTagsAndNotes () {
    return this.getState().syncTagsAndNotes
  }

  canShowDialogHelp () {
    return this.getState().showDialogHelp
  }

  canPushChanges () {
    return this.getState().pushChanges
  }

  getLastSyncedAt () {
    return this.getState().lastSyncedAt || 1
  }

  reduce (state, action) {
    if (action.type && typeof this.actions[action.type] === 'function') {
      return this.actions[action.type](state, action)
    }

    return state
  }

  handleResetFromData = (state) => {
    return {
      ...state,
      lastSyncedAt: 1,
    }
  }

  handleResetFromStore = () => {
    return this.getInitialState()
  }

  handleTogglePushChanges = (state, action) => {
    return {
      ...state,
      // при обновоении признака возможна ситуации когда прилетела обновленная дата,
      // которая не была сохранена в сторе, но есть в локал сторадже
      ...this.getInitialState(),
      pushChanges: typeof (action.payload) === 'boolean' ? action.payload : !state.pushChanges,
    }
  }

  handleUpdateLastSyncTime = (state, action) => {
    if (state.lastSyncedAt === action.payload) {
      return state
    }

    return {
      ...state,
      lastSyncedAt: action.payload,
    }
  }

  handleClearDatabase = (state) => {
    return {
      ...state,
      lastSyncedAt: 1,
    }
  }

  handleToggleShowDialogHelp = (state, action) => {
    return {
      ...state,
      showDialogHelp: Boolean(action.payload),
    }
  }

  handleToggleSyncTagsAndNotes = (state, action) => {
    return {
      ...state,
      syncTagsAndNotes: Boolean(action.payload),
    }
  }
}

export default new AppStore(dispatcher)