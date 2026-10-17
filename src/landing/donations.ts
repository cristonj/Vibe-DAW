/** Public receiving addresses only. Empty entries are omitted from the page. */
export const donationWallets = [
  { name: 'Bitcoin', network: 'Bitcoin', address: String(import.meta.env.VITE_DONATION_BTC_ADDRESS ?? '').trim(), scheme: 'bitcoin:' },
  { name: 'Ethereum', network: 'Ethereum mainnet', address: String(import.meta.env.VITE_DONATION_ETH_ADDRESS ?? '').trim(), scheme: 'ethereum:', suffix: '@1' },
  { name: 'Solana', network: 'Solana', address: String(import.meta.env.VITE_DONATION_SOL_ADDRESS ?? '').trim(), scheme: 'solana:' },
].filter((wallet) => wallet.address.length > 0);
