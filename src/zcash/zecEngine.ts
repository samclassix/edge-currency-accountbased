import { abs, add, eq, gt, lte, sub } from 'biggystring'
import {
  EdgeCurrencyEngine,
  EdgeCurrencyEngineOptions,
  EdgeCurrencyTools,
  EdgeSpendInfo,
  EdgeTransaction,
  EdgeWalletInfo,
  InsufficientFundsError,
  NoAmountSpecifiedError
} from 'edge-core-js/types'

import { CurrencyEngine } from '../common/engine'
import { PluginEnvironment } from '../common/innerPlugin'
import { cleanTxLogs } from './../common/utils'
import { ZcashTools } from './zecPlugin'
import {
  ZcashInitializerConfig,
  ZcashOtherData,
  ZcashSettings,
  ZcashSpendInfo,
  ZcashSynchronizer,
  ZcashSynchronizerStatus,
  ZcashTransaction
} from './zecTypes'

export class ZcashEngine extends CurrencyEngine<ZcashTools> {
  pluginId: string
  otherData!: ZcashOtherData
  synchronizer!: ZcashSynchronizer
  synchronizerStatus!: ZcashSynchronizerStatus
  availableZatoshi!: string
  initialNumBlocksToDownload!: number
  initializer!: ZcashInitializerConfig
  alias!: string
  progressRatio!: number
  makeSynchronizer: (
    config: ZcashInitializerConfig
  ) => Promise<ZcashSynchronizer>

  constructor(
    tools: ZcashTools,
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions,
    makeSynchronizer: any
  ) {
    super(tools, walletInfo, opts)
    this.pluginId = this.currencyInfo.pluginId
    this.makeSynchronizer = makeSynchronizer
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  initData() {
    const { birthdayHeight, alias } = this.initializer

    // walletLocalData
    if (this.otherData.blockRange == null) {
      this.otherData.blockRange = {
        first: birthdayHeight,
        last: birthdayHeight
      }
    }

    // Engine variables
    this.alias = alias
    this.initialNumBlocksToDownload = -1
    this.synchronizerStatus = 'DISCONNECTED'
    this.availableZatoshi = '0'
    this.progressRatio = 0
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  initSubscriptions() {
    this.synchronizer.on('update', async payload => {
      const { lastDownloadedHeight, scanProgress, networkBlockHeight } = payload
      this.onUpdateBlockHeight(networkBlockHeight)
      this.onUpdateProgress(
        lastDownloadedHeight,
        scanProgress,
        networkBlockHeight
      )
      await this.queryAll()
    })
    this.synchronizer.on('statusChanged', async payload => {
      this.synchronizerStatus = payload.name
      await this.queryAll()
    })
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async queryAll() {
    await this.queryBalance()
    await this.queryTransactions()
    this.onUpdateTransactions()
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  onUpdateBlockHeight(networkBlockHeight: number) {
    if (this.walletLocalData.blockHeight !== networkBlockHeight) {
      this.walletLocalData.blockHeight = networkBlockHeight
      this.walletLocalDataDirty = true
      this.currencyEngineCallbacks.onBlockHeightChanged(
        this.walletLocalData.blockHeight
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  onUpdateTransactions() {
    if (this.transactionsChangedArray.length > 0) {
      this.currencyEngineCallbacks.onTransactionsChanged(
        this.transactionsChangedArray
      )
      this.transactionsChangedArray = []
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  onUpdateProgress(
    lastDownloadedHeight: number,
    scanProgress: number,
    networkBlockHeight: number
  ) {
    if (!this.addressesChecked && !this.isSynced()) {
      // Sync status is split up between downloading blocks (40%), scanning blocks (49.5%),
      // getting balance (0.5%), and querying transactions (10%).
      this.tokenCheckBalanceStatus[this.currencyInfo.currencyCode] =
        (scanProgress * 0.99) / 100

      let downloadProgress = 0
      if (lastDownloadedHeight > 0) {
        // Initial lastDownloadedHeight value is -1
        const currentNumBlocksToDownload =
          networkBlockHeight - lastDownloadedHeight
        if (this.initialNumBlocksToDownload < 0) {
          this.initialNumBlocksToDownload = currentNumBlocksToDownload
        }

        downloadProgress =
          currentNumBlocksToDownload === 0 ||
          this.initialNumBlocksToDownload === 0
            ? 1
            : 1 - currentNumBlocksToDownload / this.initialNumBlocksToDownload
      }
      this.tokenCheckTransactionsStatus[this.currencyInfo.currencyCode] =
        downloadProgress * 0.8

      const percent =
        (this.tokenCheckTransactionsStatus[this.currencyInfo.currencyCode] +
          this.tokenCheckBalanceStatus[this.currencyInfo.currencyCode]) /
        2
      if (percent !== this.progressRatio) {
        if (Math.abs(percent - this.progressRatio) > 0.1 || percent === 1) {
          this.progressRatio = percent
          this.updateOnAddressesChecked()
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async startEngine() {
    this.initData()
    this.synchronizer = await this.makeSynchronizer(this.initializer)
    await this.synchronizer.start()
    this.initSubscriptions()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    super.startEngine()
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  isSynced() {
    // Synchronizer status is updated regularly and should be checked before accessing the db to avoid errors
    return this.synchronizerStatus === 'SYNCED'
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async queryBalance() {
    if (!this.isSynced()) return
    try {
      const balances = await this.synchronizer.getShieldedBalance()
      if (balances.totalZatoshi === '-1') return
      this.availableZatoshi = balances.availableZatoshi
      this.updateBalance(
        `${this.currencyInfo.currencyCode}`,
        balances.totalZatoshi
      )
    } catch (e: any) {
      this.warn('Failed to update balances', e)
      this.updateBalance(`${this.currencyInfo.currencyCode}`, '0')
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async queryTransactions() {
    try {
      let first = this.otherData.blockRange.first
      let last = this.otherData.blockRange.last
      while (this.isSynced() && last <= this.walletLocalData.blockHeight) {
        const transactions = await this.synchronizer.getTransactions({
          first,
          last
        })

        transactions.forEach(tx => this.processTransaction(tx))

        if (last === this.walletLocalData.blockHeight) {
          first = this.walletLocalData.blockHeight
          this.walletLocalDataDirty = true
          this.tokenCheckTransactionsStatus[this.currencyInfo.currencyCode] = 1
          this.updateOnAddressesChecked()
          break
        }

        first = last + 1
        last =
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          last +
            this.currencyInfo.defaultSettings.otherSettings
              .transactionQueryLimit <
          this.walletLocalData.blockHeight
            ? // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
              last +
              this.currencyInfo.defaultSettings.otherSettings
                .transactionQueryLimit
            : this.walletLocalData.blockHeight

        this.otherData.blockRange = {
          first,
          last
        }
        this.walletLocalDataDirty = true
      }
    } catch (e: any) {
      this.error(
        `Error querying ${this.currencyInfo.currencyCode} transactions `,
        e
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  processTransaction(tx: ZcashTransaction) {
    let netNativeAmount = tx.value
    const ourReceiveAddresses = []
    if (tx.toAddress != null) {
      // check if tx is a spend
      netNativeAmount = `-${add(
        netNativeAmount,
        this.currencyInfo.defaultSettings.otherSettings.defaultNetworkFee
      )}`
    } else {
      ourReceiveAddresses.push(this.walletInfo.keys.publicKey)
    }

    const edgeTransaction: EdgeTransaction = {
      txid: tx.rawTransactionId,
      date: tx.blockTimeInSeconds,
      currencyCode: `${this.currencyInfo.currencyCode}`,
      blockHeight: tx.minedHeight,
      nativeAmount: netNativeAmount,
      networkFee:
        this.currencyInfo.defaultSettings.otherSettings.defaultNetworkFee,
      ourReceiveAddresses, // blank if you sent money otherwise array of addresses that are yours in this transaction
      signedTx: '',
      otherParams: {}
    }
    this.addTransaction(`${this.currencyInfo.currencyCode}`, edgeTransaction)
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async killEngine() {
    await this.synchronizer.stop()
    await super.killEngine()
  }

  async clearBlockchainCache(): Promise<void> {
    await super.clearBlockchainCache()
  }

  async resyncBlockchain(): Promise<void> {
    // Don't bother stopping and restarting the synchronizer for a resync
    await super.killEngine()
    await this.clearBlockchainCache()
    await this.startEngine()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.synchronizer.rescan(
      this.walletInfo.keys[`${this.pluginId}BirthdayHeight`] ??
        this.currencyInfo.defaultSettings.otherSettings.defaultBirthday
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getMaxSpendable(spendInfo: EdgeSpendInfo): Promise<string> {
    const spendableBalance = sub(
      this.availableZatoshi,
      this.currencyInfo.defaultSettings.otherSettings.defaultNetworkFee
    )
    if (lte(spendableBalance, '0')) throw new InsufficientFundsError()

    return spendableBalance
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async makeSpend(edgeSpendInfoIn: EdgeSpendInfo) {
    if (!this.isSynced()) throw new Error('Cannot spend until wallet is synced')
    const { edgeSpendInfo, currencyCode } = this.makeSpendCheck(edgeSpendInfoIn)
    const spendTarget = edgeSpendInfo.spendTargets[0]
    const { publicAddress, nativeAmount } = spendTarget

    if (publicAddress == null)
      throw new Error('makeSpend Missing publicAddress')
    if (nativeAmount == null) throw new NoAmountSpecifiedError()

    if (eq(nativeAmount, '0')) throw new NoAmountSpecifiedError()

    const totalTxAmount = add(
      nativeAmount,
      this.currencyInfo.defaultSettings.otherSettings.defaultNetworkFee
    )

    if (
      gt(
        totalTxAmount,
        this.walletLocalData.totalBalances[this.currencyInfo.currencyCode]
      )
    ) {
      throw new InsufficientFundsError()
    }

    if (gt(totalTxAmount, this.availableZatoshi)) {
      throw new InsufficientFundsError('Amount exceeds available balance')
    }

    // **********************************
    // Create the unsigned EdgeTransaction

    const spendTargets = edgeSpendInfo.spendTargets.map(si => ({
      uniqueIdentifier: si.uniqueIdentifier,
      memo: si.memo,
      nativeAmount: si.nativeAmount ?? '0',
      currencyCode,
      publicAddress
    }))

    const edgeTransaction: EdgeTransaction = {
      txid: '', // txid
      date: 0, // date
      currencyCode, // currencyCode
      blockHeight: 0, // blockHeight
      nativeAmount: `-${totalTxAmount}`, // nativeAmount
      networkFee:
        this.currencyInfo.defaultSettings.otherSettings.defaultNetworkFee, // networkFee
      ourReceiveAddresses: [], // ourReceiveAddresses
      signedTx: '', // signedTx
      spendTargets
    }

    return edgeTransaction
  }

  async signTx(edgeTransaction: EdgeTransaction): Promise<EdgeTransaction> {
    // Transaction is signed and broadcast at the same time
    return edgeTransaction
  }

  async broadcastTx(
    edgeTransaction: EdgeTransaction
  ): Promise<EdgeTransaction> {
    if (
      edgeTransaction.spendTargets == null ||
      edgeTransaction.spendTargets.length !== 1
    )
      throw new Error('Invalid spend targets')

    const spendTarget = edgeTransaction.spendTargets[0]
    const txParams: ZcashSpendInfo = {
      zatoshi: sub(
        abs(edgeTransaction.nativeAmount),
        edgeTransaction.networkFee
      ),
      toAddress: spendTarget.publicAddress,
      memo: spendTarget.memo ?? spendTarget.uniqueIdentifier ?? '',
      fromAccountIndex: 0,
      spendingKey: this.walletInfo.keys[`${this.pluginId}SpendKey`]
    }

    try {
      const signedTx = await this.synchronizer.sendToAddress(txParams)
      edgeTransaction.txid = signedTx.txId
      edgeTransaction.signedTx = signedTx.raw
      edgeTransaction.date = Date.now() / 1000
      this.warn(`SUCCESS broadcastTx\n${cleanTxLogs(edgeTransaction)}`)
    } catch (e: any) {
      this.warn('FAILURE broadcastTx failed: ', e)
      throw e
    }
    return edgeTransaction
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  getDisplayPrivateSeed() {
    if (
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-optional-chain
      this.walletInfo.keys &&
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      this.walletInfo.keys[`${this.pluginId}Mnemonic`]
    ) {
      return this.walletInfo.keys[`${this.pluginId}Mnemonic`]
    }
    return ''
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  getDisplayPublicSeed() {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-optional-chain
    if (this.walletInfo.keys && this.walletInfo.keys.publicKey) {
      return this.walletInfo.keys.unifiedViewingKeys.extfvk
    }
    return ''
  }

  async loadEngine(
    plugin: EdgeCurrencyTools,
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<void> {
    await super.loadEngine(plugin, walletInfo, opts)
    this.engineOn = true

    if (
      this.walletInfo.keys.publicKey != null ||
      this.walletInfo.keys.unifiedViewingKeys != null
    ) {
      const pubKeys = await plugin.derivePublicKey(this.walletInfo)
      this.walletInfo.keys.publicKey = pubKeys.publicKey
      this.walletInfo.keys[`${this.pluginId}ViewKeys`] =
        pubKeys.unifiedViewingKeys
    }
    const { rpcNode, defaultBirthday }: ZcashSettings =
      this.currencyInfo.defaultSettings.otherSettings
    this.initializer = {
      fullViewingKey: this.walletInfo.keys[`${this.pluginId}ViewKeys`],
      birthdayHeight:
        this.walletInfo.keys[`${this.pluginId}BirthdayHeight`] ??
        defaultBirthday,
      alias: this.walletInfo.keys.publicKey,
      ...rpcNode
    }
  }
}
export async function makeCurrencyEngine(
  env: PluginEnvironment<{}>,
  tools: ZcashTools,
  walletInfo: EdgeWalletInfo,
  opts: EdgeCurrencyEngineOptions
): Promise<EdgeCurrencyEngine> {
  const { makeSynchronizer } = env.nativeIo['edge-currency-accountbased']

  const engine = new ZcashEngine(tools, walletInfo, opts, makeSynchronizer)

  // Do any async initialization necessary for the engine
  await engine.loadEngine(tools, walletInfo, opts)

  // This is just to make sure otherData is Flow checked
  engine.otherData = engine.walletLocalData.otherData as any

  return engine
}
