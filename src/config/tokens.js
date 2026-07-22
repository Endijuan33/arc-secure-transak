import usdcLogo from '../assets/tokens/usdc.svg';
import eurcLogo from '../assets/tokens/eurc.svg';
import cirbtcLogo from '../assets/tokens/cirbtc.svg';

export const KNOWN_TOKENS = [
  {
    address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    symbol: 'EURC',
    name: 'Euro Coin',
    decimals: 6,
    logo: eurcLogo
  },
  {
    address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
    symbol: 'cirBTC',
    name: 'Circle Wrapped Bitcoin',
    decimals: 8,
    logo: cirbtcLogo
  }
];

export const NATIVE_TOKEN = {
  symbol: 'USDC',
  name: 'Native USDC',
  decimals: 18,
  isNative: true,
  logo: usdcLogo
};
