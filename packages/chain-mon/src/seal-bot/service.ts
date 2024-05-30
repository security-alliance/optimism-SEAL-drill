import {
  BaseServiceV2,
  StandardOptions,
  ExpressRouter,
  Gauge,
  validators,
  waitForProvider,
} from '@eth-optimism/common-ts'
import {
  getOEContract,
  DEFAULT_L2_CONTRACT_ADDRESSES,
  CrossChainMessenger,
  DeepPartial,
  OEContracts,
  MessageStatus,
  SignerOrProviderLike,
} from '@eth-optimism/sdk'
import { getChainId, sleep } from '@eth-optimism/core-utils'
import { Provider } from '@ethersproject/abstract-provider'
import { BigNumber, Signer, Wallet, ethers, utils } from 'ethers'
import dateformat from 'dateformat'

import { version } from '../../package.json'

import { SealTokenAbi, L2Abi } from './SealTokenAbi'

type Options = {
  l1RpcProvider: Provider
  l2RpcProvider: Provider
  mnemonic: string
  faucetKey: string
  sleepTimeMs: number
  numBots: number
  minimumBotBalance: string
  faucetEthTxAmount: string
  faucetSealTxAmount: string
}

type Metrics = {
  nodeConnectionFailures: Gauge
  faucetL1Balance: Gauge
  faucetSealBalance: Gauge
  l1Balances: Gauge
  l2Balances: Gauge
  l1SealBalances: Gauge
  l2SealBalances: Gauge
}

type Bot = {
  l1Signer: Signer
  l2Signer: Signer
  l1EthBalance: BigNumber
  l2EthBalance: BigNumber
  l1SealBalance: BigNumber
  l2SealBalance: BigNumber
  messenger: CrossChainMessenger
  address: string
  nickname: string
  pendingWithdrawals: Set<string>
  finalizedWithdrawals: Set<string>
}

type State = {
  bots: Bot[]
  faucetSigner: Signer
  messenger: CrossChainMessenger
  botFailed: boolean
  l1SealToken: ethers.Contract
  l2SealToken: ethers.Contract
}

const l1SealTokenAddress = '0x608ddcdf387c1638993dc0f45dfd2746b08b9b4a'
const l2SealTokenAddress = '0x3C25ea40b92D81BefA053a14c424107211371A0c'

const addresses: Record<number, { AddressManager: string; L1CrossDomainMessenger: string; L1StandardBridge: string; OptimismPortal: string; L2OutputOracle: string }> = {
  70460: { // DEV
    AddressManager: '0x0ee1e4dDb886333B34D6706dFA42fDc1A76cbA58',
    L1CrossDomainMessenger: '0x99A1e936B9744a12f86da049DA735a37E3560d97',
    L1StandardBridge: '0x99b1b68b921f0965183073c26a72389143048256',
    OptimismPortal: '0x38b7077a75b1853659bea8a8262ed052db8e3e8a',
    L2OutputOracle: '0x3fe6d1f8721189b05fac2525b6794ceb3e492273',
  },
  18714: { // OP
    AddressManager: '0x6b3d052F853736809C9cAf9FE5d74D5e1206afD1',
    L1CrossDomainMessenger: '0x69924a24EaA7CcD26F77e23ec5d2cB140E5974e8',
    L1StandardBridge: '0x0d954ca7FbeC298b20379297Ca0858046beDf106',
    OptimismPortal: '0xa44a4311f19eAeEAE9B413358EaC07cbeDC2Ed38',
    L2OutputOracle: '0x96968aDc6bf04cb9ac7c5E8F905AFA3E163E1C10',
  },
  6619: { // BASE
    AddressManager: '0x7cCd010766BfAf767406D7efa074E8d235180943',
    L1CrossDomainMessenger: '0xBd3Af03052db6fb124aD89843E225330ecBF91b6',
    L1StandardBridge: '0x057F662327b5c961A77E58577241ee33D0aAE624',
    OptimismPortal: '0x6D4BFD3F847178E5B82898c261054349d44d44d6',
    L2OutputOracle: '0x5b5bc4942Dc0Bf62746211D1979DeEF29221119D',
  },
}

export class SealBot extends BaseServiceV2<Options, Metrics, State> {
  constructor(options?: Partial<Options & StandardOptions>) {
    super({
      version,
      name: 'seal-bot',
      loop: true,
      options: {
        loopIntervalMs: 1000,
        ...options,
      },
      optionsSpec: {
        l1RpcProvider: {
          validator: validators.provider,
          desc: 'Provider for interacting with L1',
        },
        l2RpcProvider: {
          validator: validators.provider,
          desc: 'Provider for interacting with L2',
        },
        mnemonic: {
          validator: validators.str,
          desc: 'Mnemonic for the L1/L2 account that will be used to send transactions',
        },
        faucetKey: {
          validator: validators.str,
          desc: 'Private key for the faucet account that will be used to send transactions',
        },
        numBots: {
          validator: validators.num,
          default: 10,
          desc: 'Number of bots to run',
        },
        sleepTimeMs: {
          validator: validators.num,
          default: 15000,
          desc: 'Time in ms to sleep when waiting for a node',
          public: true,
        },
        minimumBotBalance: {
          validator: validators.str,
          default: '0.01',
          desc: 'Minimum balance of a bot',
        },
        faucetEthTxAmount: {
          validator: validators.str,
          default: '0.5',
          desc: 'Amount of ETH to request from the faucet',
        },
        faucetSealTxAmount: {
          validator: validators.str,
          default: '100',
          desc: 'Amount of SEAL to request from the faucet',
        },
      },
      metricsSpec: {
        nodeConnectionFailures: {
          type: Gauge,
          desc: 'Number of times node connection has failed',
          labels: ['layer', 'section'],
        },
        faucetL1Balance: {
          type: Gauge,
          desc: 'Faucet L1 balance',
        },
        faucetSealBalance: {
          type: Gauge,
          desc: 'Faucet seal balance',
        },
        l1Balances: {
          type: Gauge,
          desc: 'Balances of addresses',
          labels: ['address', 'nickname'],
        },
        l1SealBalances: {
          type: Gauge,
          desc: 'Balances of addresses',
          labels: ['address', 'nickname'],
        },
        l2Balances: {
          type: Gauge,
          desc: 'Balances of addresses',
          labels: ['address', 'nickname'],
        },
        l2SealBalances: {
          type: Gauge,
          desc: 'Balances of addresses',
          labels: ['address', 'nickname'],
        },
      },
    })
  }

  private getRandomOtherBot(bot: Bot): Bot {
    return this.state.bots.filter((b) => b.address !== bot.address)[
      Math.floor(Math.random() * (this.state.bots.length - 1))
    ]
  }

  private async getMessenger(
    l1Signer: SignerOrProviderLike,
    l2Signer: SignerOrProviderLike
  ): Promise<CrossChainMessenger> {
    // Need L2 chain ID to resolve contract addresses.
    const l1ChainId = 11155111
    const l2ChainId = await getChainId(this.options.l2RpcProvider)
    if (!addresses[l2ChainId]) {
      throw new Error(`Unsupported L2 chain ID: ${l2ChainId}`)
    }
    const contracts: DeepPartial<OEContracts> = {
      l1: {
        AddressManager: getOEContract('AddressManager', l1ChainId, {
          address: addresses[l2ChainId].AddressManager,
        }),
        L1CrossDomainMessenger: getOEContract(
          'L1CrossDomainMessenger',
          l1ChainId,
          {
            address: addresses[l2ChainId].L1CrossDomainMessenger,
          }
        ),
        L1StandardBridge: getOEContract('L1StandardBridge', l1ChainId, {
          address: addresses[l2ChainId].L1StandardBridge,
        }),
        OptimismPortal: getOEContract('OptimismPortal', l1ChainId, {
          address: addresses[l2ChainId].OptimismPortal,
        }),
        L2OutputOracle: getOEContract('L2OutputOracle', l1ChainId, {
          address: addresses[l2ChainId].L2OutputOracle,
        }),
      },
    }
    return new CrossChainMessenger({
      l1ChainId,
      l2ChainId,
      l1SignerOrProvider: l1Signer,
      l2SignerOrProvider: l2Signer,
      contracts,
    })
  }

  async init(): Promise<void> {
    // Connect to L1.
    await waitForProvider(this.options.l1RpcProvider, {
      logger: this.logger,
      name: 'L1',
    })

    // Connect to L2.
    await waitForProvider(this.options.l2RpcProvider, {
      logger: this.logger,
      name: 'L2',
    })

    this.state.messenger = await this.getMessenger(
      this.options.l1RpcProvider,
      this.options.l2RpcProvider
    )

    this.state.faucetSigner = new Wallet(this.options.faucetKey).connect(
      this.options.l1RpcProvider
    )

    const faucetAddress = await this.state.faucetSigner.getAddress()
    console.log(`Initialized faucet signer ${faucetAddress}`)

    this.state.l1SealToken = new ethers.Contract(
      l1SealTokenAddress,
      SealTokenAbi,
      this.options.l1RpcProvider
    )

    this.state.l2SealToken = new ethers.Contract(
      l2SealTokenAddress,
      L2Abi,
      this.options.l2RpcProvider
    )

    this.state.bots = []

    Array.from({ length: this.options.numBots }).forEach(async (_, i) => {
      const l1Signer = Wallet.fromMnemonic(
        this.options.mnemonic,
        `m/44'/60'/0'/0/${i}`
      ).connect(this.options.l1RpcProvider)
      const l2Signer = Wallet.fromMnemonic(
        this.options.mnemonic,
        `m/44'/60'/0'/0/${i}`
      ).connect(this.options.l2RpcProvider)
      this.state.bots.push({
        l1Signer,
        l2Signer,
        messenger: await this.getMessenger(l1Signer, l2Signer),
        address: l1Signer.address,
        pendingWithdrawals: new Set(),
        finalizedWithdrawals: new Set(),
        l1EthBalance: BigNumber.from(0),
        l2EthBalance: BigNumber.from(0),
        l1SealBalance: BigNumber.from(0),
        l2SealBalance: BigNumber.from(0),
        nickname: `L1-${i}`,
      })
      console.log(`Added L1 signer ${l1Signer.address}`)
    })
  }

  // K8s healthcheck
  async routes(router: ExpressRouter): Promise<void> {
    router.get('/healthz', async (req, res) => {
      return res.status(200).json({
        ok: !this.state.botFailed,
      })
    })
  }

  private async ensureMinimumBalances(bot: Bot): Promise<void> {
    // Parse options
    const minimumBotBalance = utils.parseEther(this.options.minimumBotBalance)
    const faucetEthTxAmount = utils.parseEther(this.options.faucetEthTxAmount)
    const faucetSealTxAmount = utils.parseEther(this.options.faucetSealTxAmount)

    if (bot.l1EthBalance.lt(minimumBotBalance)) {
      console.log(
        `L1 signer ${bot.address} balance: ${bot.l1EthBalance} < ${minimumBotBalance}`
      )
      const faucetEthTx = await this.state.faucetSigner.sendTransaction({
        to: bot.address,
        value: faucetEthTxAmount,
      })
      await faucetEthTx.wait()
    }

    if (bot.l1SealBalance < faucetSealTxAmount) {
      console.log(
        `L1 signer ${bot.address} seal balance: ${bot.l1SealBalance} < ${faucetSealTxAmount}`
      )
      const faucetSealTx = await this.state.faucetSigner.sendTransaction(
        await this.state.l1SealToken.populateTransaction.transfer(
          bot.address,
          faucetSealTxAmount
        )
      )
      await faucetSealTx.wait()
    }
  }

  private async trackBotBalances(bot: Bot): Promise<void> {
    const l1Balance = await bot.l1Signer.getBalance()
    this.metrics.l1Balances.set(
      { address: bot.address, nickname: bot.nickname },
      parseInt(l1Balance.toString(), 10)
    )

    const sealL1Balance = await this.state.l1SealToken.balanceOf(bot.address)
    this.metrics.l1SealBalances.set(
      { address: bot.address, nickname: bot.nickname },
      parseInt(sealL1Balance.toString(), 10)
    )

    const l2Balance = await bot.l2Signer.getBalance()
    this.metrics.l2Balances.set(
      { address: bot.address, nickname: bot.nickname },
      parseInt(l2Balance.toString(), 10)
    )

    const sealL2Balance = await this.state.l2SealToken.balanceOf(bot.address)
    this.metrics.l2SealBalances.set(
      { address: bot.address, nickname: bot.nickname },
      parseInt(sealL2Balance.toString(), 10)
    )

    bot.l1EthBalance = l1Balance
    bot.l2EthBalance = l2Balance
    bot.l1SealBalance = sealL1Balance
    bot.l2SealBalance = sealL2Balance
  }

  private async trackFaucetBalances(): Promise<void> {
    const faucetL1Balance = await this.state.faucetSigner.getBalance()
    console.log(`Faucet L1 balance: ${faucetL1Balance}`)
    const faucetAddress = await this.state.faucetSigner.getAddress()
    const faucetSealBalance = await this.state.l1SealToken.balanceOf(
      faucetAddress
    )
    this.metrics.faucetL1Balance.set(parseInt(faucetL1Balance.toString(), 10))
    this.metrics.faucetSealBalance.set(
      parseInt(faucetSealBalance.toString(), 10)
    )
    console.log(`Faucet seal balance: ${faucetSealBalance}`)
  }

  private async processBotWithdrawals(bot: Bot): Promise<void> {
    const withdrawals = await bot.messenger.getWithdrawalsByAddress(bot.address)
    console.log(`Found ${withdrawals.length} withdrawals for ${bot.address}`)
    for (const withdrawal of withdrawals) {
      let messageStatus: MessageStatus
      // If already finalized skip getting status
      if (bot.finalizedWithdrawals.has(withdrawal.transactionHash)) {
        messageStatus = MessageStatus.RELAYED
      } else {
        messageStatus = await bot.messenger.getMessageStatus(
          withdrawal.transactionHash
        )
      }
      console.log('Withdrawal:')
      console.log('----------------------------------------------------')
      console.log('From:    ', withdrawal.from)
      console.log('To:      ', withdrawal.to)
      console.log('Hash:    ', withdrawal.transactionHash)
      console.log('Index:    ', withdrawal.logIndex)
      console.log('L1 Token:', withdrawal.l1Token)
      console.log('L2 Token:', withdrawal.l2Token)
      console.log('Amount:  ', withdrawal.amount.toString())
      console.log('Status:  ', MessageStatus[messageStatus])

      if (messageStatus === MessageStatus.RELAYED) {
        if (bot.pendingWithdrawals.has(withdrawal.transactionHash)) {
          bot.pendingWithdrawals.delete(withdrawal.transactionHash)
        }
        if (!bot.finalizedWithdrawals.has(withdrawal.transactionHash)) {
          bot.finalizedWithdrawals.add(withdrawal.transactionHash)
        }
      } else {
        if (!bot.pendingWithdrawals.has(withdrawal.transactionHash)) {
          bot.pendingWithdrawals.add(withdrawal.transactionHash)
        }
      }

      if (messageStatus === MessageStatus.READY_TO_PROVE) {
        console.log(`Proving ${withdrawal.transactionHash}`)
        const proveTx = await bot.messenger.proveMessage(
          withdrawal.transactionHash
        )
        await proveTx.wait()
        console.log(`Proved ${withdrawal.transactionHash}`)
      } else if (messageStatus === MessageStatus.READY_FOR_RELAY) {
        console.log(`Relaying ${withdrawal.transactionHash}`)
        const relayTxRequest = await bot.messenger.finalizeMessage(
          withdrawal.transactionHash
        )
        await relayTxRequest.wait()
        console.log(`Relayed ${withdrawal.transactionHash}`)
      }
    }
  }

  private async runBotSealApproval(bot: Bot): Promise<void> {
    console.log(
      `Approving ${utils.formatEther(bot.l1SealBalance)} SEAL from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
    const approveTx = await bot.messenger.approveERC20(
      l1SealTokenAddress,
      l2SealTokenAddress,
      bot.l1SealBalance
    )
    await approveTx.wait()
  }

  private async runBotEthDeposits(bot: Bot): Promise<void> {
    const depositAmount = bot.l1EthBalance.div(3)
    console.log(
      `Depositing ${utils.formatEther(depositAmount)} ETH from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
    const depositTx = await bot.messenger.depositETH(depositAmount)
    await depositTx.wait()
    console.log(`Waiting for deposit to be relayed ${depositTx.hash}`)
    await bot.messenger.waitForMessageStatus(
      depositTx.hash,
      MessageStatus.RELAYED
    )
    console.log(
      `Deposited ${utils.formatEther(depositAmount)} ETH from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
  }

  private async runBotEthWithdrawals(bot: Bot): Promise<void> {
    const withdrawAmount = bot.l2EthBalance.div(3)
    console.log(
      `Withdrawing ${utils.formatEther(withdrawAmount)} ETH from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
    const withdrawTx = await bot.messenger.withdrawETH(withdrawAmount)
    await withdrawTx.wait()
    console.log(
      `Withdrawn ${utils.formatEther(withdrawAmount)} ETH from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
  }

  private async runBotSealDeposits(bot: Bot): Promise<void> {
    const depositAmount = bot.l1SealBalance.div(3)
    console.log(
      `Depositing ${utils.formatEther(depositAmount)} SEAL from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
    const depositTx = await bot.messenger.depositERC20(
      l1SealTokenAddress,
      l2SealTokenAddress,
      depositAmount
    )
    await depositTx.wait()
    console.log(`Waiting for deposit to be relayed ${depositTx.hash}`)
    await bot.messenger.waitForMessageStatus(
      depositTx.hash,
      MessageStatus.RELAYED
    )
    console.log(
      `Deposited ${utils.formatEther(depositAmount)} SEAL from ${
        bot.address
      } to ${l2SealTokenAddress}`
    )
  }

  private async runBotSealTransfers(bot: Bot): Promise<void> {
    const transferAmount = bot.l2SealBalance.div(3)
    const otherBot = this.getRandomOtherBot(bot)
    console.log(
      `Transferring ${utils.formatEther(transferAmount)} SEAL from ${
        bot.address
      } to ${otherBot.address}`
    )
    const transferTx = await bot.l2Signer.sendTransaction(
      await this.state.l2SealToken.populateTransaction.transfer(
        otherBot.address,
        transferAmount
      )
    )
    await transferTx.wait()
    console.log(
      `Transferred ${utils.formatEther(transferAmount)} SEAL from ${
        bot.address
      } to ${otherBot.address}`
    )
  }

  private async runBotSealWithdrawals(bot: Bot): Promise<void> {
    const withdrawAmount = bot.l2SealBalance.div(3)
    console.log(
      `Withdrawing ${utils.formatEther(withdrawAmount)} SEAL from ${
        bot.address
      } to ${bot.address}`
    )
    const withdrawTx = await bot.messenger.withdrawERC20(
      l1SealTokenAddress,
      l2SealTokenAddress,
      withdrawAmount
    )
    await withdrawTx.wait()
    console.log(
      `Withdrawn ${utils.formatEther(withdrawAmount)} SEAL from ${
        bot.address
      } to ${bot.address}`
    )
  }

  private async trackBotDeposits(bot: Bot): Promise<void> {
    const deposits = await bot.messenger.getDepositsByAddress(bot.address)
    console.log(`Found ${deposits.length} deposits for ${bot.address}`)

    for (const deposit of deposits) {
      console.log('Deposit:')
      console.log('----------------------------------------------------')
      console.log('From:    ', deposit.from)
      console.log('To:      ', deposit.to)
      console.log('L1 Token:', deposit.l1Token)
      console.log('L2 Token:', deposit.l2Token)
      console.log('Amount:  ', deposit.amount.toString())
    }
  }

  async main(): Promise<void> {
    this.state.botFailed = false

    // Parse options
    const minimumBotBalance = utils.parseEther(this.options.minimumBotBalance)

    // Check balance of faucet

    // For each bot:
    // - Check balance of bot
    // - If balance < minimumBotBalance, send faucetEthTxAmount to bot
    // - If balance < faucetSealTxAmount, send faucetSealTxAmount to bot
    // - Check balance of bot on L2
    // - If balance < minimumBotBalance, send depositAmount to L2
    // - If balance > minimumBotBalance, send withdrawAmount to L2
    // - If balance > minimumBotBalance, send transferAmount to otherBot
    // - Check withdrawal messages
    // - If withdrawal message status is ready, prove and finalize

    await this.trackFaucetBalances()

    for (const bot of this.state.bots) {
      await this.trackBotBalances(bot)
      console.log('Bot: ', bot.nickname)
      console.log('----------------------------------------------------')
      console.log('Address:    ', bot.address)
      console.log('L1 SEAL Balance:', utils.formatEther(bot.l1SealBalance))
      console.log('L2 SEAL Balance:', utils.formatEther(bot.l2SealBalance))
      console.log('L1 ETH Balance:', utils.formatEther(bot.l1EthBalance))
      console.log('L2 ETH Balance:', utils.formatEther(bot.l2EthBalance))
      console.log('Pending Withdrawals:', bot.pendingWithdrawals.size)
      console.log('Finalized Withdrawals:', bot.finalizedWithdrawals.size)
      await this.ensureMinimumBalances(bot)
      await this.processBotWithdrawals(bot)

      const approval = await bot.messenger.approval(
        l1SealTokenAddress,
        l2SealTokenAddress
      )

      console.log(`L1 signer ${bot.address} approval: ${approval}`)
      if (approval.lt(bot.l1SealBalance)) {
        await this.runBotSealApproval(bot)
      }

      if (
        bot.l2EthBalance.lt(minimumBotBalance) &&
        bot.l1EthBalance.gt(minimumBotBalance)
      ) {
        await this.runBotEthDeposits(bot)
      } else if (bot.l2EthBalance.gt(minimumBotBalance)) {
        if (bot.pendingWithdrawals.size < 2) {
          await this.runBotEthWithdrawals(bot)
        } else {
          console.log(`Bot already has pending withdrawals`)
        }
      }

      if (
        bot.l2SealBalance.lt(minimumBotBalance) &&
        bot.l1SealBalance.gt(minimumBotBalance)
      ) {
        await this.runBotSealDeposits(bot)
      } else if (
        bot.l2EthBalance.gt(minimumBotBalance) &&
        bot.l2SealBalance.gt(minimumBotBalance)
      ) {
        await this.runBotSealTransfers(bot)
        if (bot.pendingWithdrawals.size < 2) {
          await this.runBotSealWithdrawals(bot)
        } else {
          console.log(`Bot already has pending withdrawals`)
        }
      }
      await this.trackBotDeposits(bot)
      console.log('----------------------------------------------------')
      console.log('----------------------------------------------------')
    }

    return sleep(this.options.sleepTimeMs)
  }
}

if (require.main === module) {
  const service = new SealBot()
  service.run()
}
