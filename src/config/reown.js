// src/config/reown.js
import { createAppKit } from '@reown/appkit/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { defineChain } from '@reown/appkit/networks'

// Define Arc Testnet with multiple RPC endpoints for failover
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.drpc.testnet.arc.network',
	'https://rpc.testnet.arc.network',
	'https://5042002.rpc.thirdweb.com',
	'https://rpc.blockdaemon.testnet.arc.network',
	'https://rpc.quicknode.testnet.arc.network'
      ]
    },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
})

// Load Project ID from environment variable
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID

const metadata = {
  name: 'Arc Secure Transak',
  description: 'Send Native USDC using a disposable Burner Address',
  url: 'http://localhost:5173',
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}

export const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [arcTestnet],
  metadata,
  projectId,
  features: {
    analytics: true
  }
})
