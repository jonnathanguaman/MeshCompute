import type { WalletSummaryDTO } from '@meshcompute/contracts';
import { CircleDollarSign, ReceiptText, Server, Wallet } from 'lucide-react';
import { formatTokenAtomic, shortHash } from '@/lib/format-money';

export function WalletCard({ wallet }: { wallet: WalletSummaryDTO }) {
  if (wallet.role === 'CLIENT') {
    return (
      <div className="wallet-strip">
        <div className="wallet-item wallet-main">
          <Wallet size={20} />
          <div><span>Available balance</span><strong>{formatTokenAtomic(wallet.balanceAtomic)} <small>mUSDT</small></strong></div>
        </div>
        <div className="wallet-item">
          <CircleDollarSign size={17} />
          <div><span>Spent</span><strong>{formatTokenAtomic(wallet.spentAtomic)} <small>mUSDT</small></strong></div>
        </div>
        <div className="wallet-item">
          <ReceiptText size={17} />
          <div><span>Jobs paid</span><strong>{wallet.jobsPaid}</strong></div>
        </div>
        <div className="wallet-item wallet-muted">
          <div><span>Initial demo credit</span><strong>{formatTokenAtomic(wallet.initialCreditAtomic)} <small>mUSDT</small></strong></div>
        </div>
      </div>
    );
  }
  return (
    <div className="wallet-strip">
      <div className="wallet-item wallet-main">
        <Wallet size={20} />
        <div><span>Total earned</span><strong>{formatTokenAtomic(wallet.earnedAtomic)} <small>mUSDT</small></strong></div>
      </div>
      <div className="wallet-item">
        <ReceiptText size={17} />
        <div><span>Jobs paid</span><strong>{wallet.jobsPaid}</strong></div>
      </div>
      <div className="wallet-item">
        <Server size={17} />
        <div><span>Machines</span><strong>{wallet.listings}</strong></div>
      </div>
      <div className="wallet-item wallet-muted">
        <div><span>Payout wallet</span><strong className="wallet-address">{wallet.walletAddress ? shortHash(wallet.walletAddress) : '—'}</strong></div>
      </div>
    </div>
  );
}
