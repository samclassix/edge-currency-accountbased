import {
  asBoolean,
  asCodec,
  asMaybe,
  asNumber,
  asObject,
  asString,
  Cleaner
} from 'cleaners'
import { Subscriber } from 'yaob'

import { asWalletInfo } from '../common/types'

type ZcashNetworkName = 'mainnet' | 'testnet'

export interface ZcashNetworkInfo {
  rpcNode: {
    networkName: ZcashNetworkName
    defaultHost: string
    defaultPort: number
  }
  defaultNetworkFee: string
  defaultBirthday: number
}

export interface ZcashSpendInfo {
  zatoshi: string
  toAddress: string
  memo: string
  fromAccountIndex: number
  mnemonicSeed: string
}

export interface ZcashTransaction {
  rawTransactionId: string
  blockTimeInSeconds: number
  minedHeight: number
  value: string
  toAddress?: string
  memos: string[]
}

export interface ZcashPendingTransaction {
  txId: string
  raw: string
}

export interface ZcashWalletBalance {
  availableZatoshi: string
  totalZatoshi: string
}

export interface UnifiedViewingKey {
  extfvk: string
  extpub: string
}

export interface ZcashInitializerConfig {
  networkName: ZcashNetworkName
  defaultHost: string
  defaultPort: number
  mnemonicSeed: string
  alias: string
  birthdayHeight: number
  newWallet: boolean
}

export interface ZcashAddresses {
  unifiedAddress: string
  saplingAddress: string
  transparentAddress: string
}

export type ZcashSynchronizerStatus =
  | 'STOPPED'
  | 'DISCONNECTED'
  | 'SYNCING'
  | 'SYNCED'

export interface ZcashBalanceEvent {
  availableZatoshi: string
  totalZatoshi: string
}

export interface ZcashStatusEvent {
  alias: string
  name: ZcashSynchronizerStatus
}

export interface ZcashTransactionsEvent {
  transactions: ZcashTransaction[]
}

export interface ZcashUpdateEvent {
  alias: string
  isDownloading: boolean
  isScanning: boolean
  lastDownloadedHeight: number
  lastScannedHeight: number
  scanProgress: number // 0 - 100
  networkBlockHeight: number
}

// Block range is inclusive
export const asZcashBlockRange = asObject({
  first: asNumber,
  last: asNumber
})

export type ZcashBlockRange = ReturnType<typeof asZcashBlockRange>

export const asZcashWalletOtherData = asObject({
  isSdkInitializedOnDisk: asMaybe(asBoolean, false)
})

export type ZcashWalletOtherData = ReturnType<typeof asZcashWalletOtherData>

export interface ZcashSynchronizer {
  on: Subscriber<{
    balanceChanged: ZcashBalanceEvent
    statusChanged: ZcashStatusEvent
    transactionsChanged: ZcashTransactionsEvent
    update: ZcashUpdateEvent
  }>
  start: () => Promise<void>
  stop: () => Promise<void>
  deriveUnifiedAddress: () => Promise<ZcashAddresses>
  getTransactions: (arg: ZcashBlockRange) => Promise<ZcashTransaction[]>
  rescan: () => Promise<string>
  sendToAddress: (arg: ZcashSpendInfo) => Promise<ZcashPendingTransaction>
  getBalance: () => Promise<ZcashWalletBalance>
}

export type ZcashMakeSynchronizer = () => (
  config: ZcashInitializerConfig
) => Promise<ZcashSynchronizer>

export const asZecPublicKey = asObject({
  birthdayHeight: asNumber,
  publicKey: asString
})

export type SafeZcashWalletInfo = ReturnType<typeof asSafeZcashWalletInfo>
export const asSafeZcashWalletInfo = asWalletInfo(asZecPublicKey)

export interface ZcashPrivateKeys {
  mnemonic: string
  birthdayHeight: number
}
export const asZcashPrivateKeys = (
  pluginId: string
): Cleaner<ZcashPrivateKeys> => {
  const asKeys = asObject({
    [`${pluginId}Mnemonic`]: asString,
    [`${pluginId}BirthdayHeight`]: asNumber
  })

  return asCodec(
    raw => {
      const clean = asKeys(raw)
      return {
        mnemonic: clean[`${pluginId}Mnemonic`] as string,
        birthdayHeight: clean[`${pluginId}BirthdayHeight`] as number
      }
    },
    clean => {
      return {
        [`${pluginId}Mnemonic`]: clean.mnemonic,
        [`${pluginId}BirthdayHeight`]: clean.birthdayHeight
      }
    }
  )
}
