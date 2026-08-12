/** Minimal ABI fragments. Kept narrow so no unintended method is callable. */

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

export const ERC721_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
] as const;

export const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function uri(uint256 id) view returns (string)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
] as const;

/** ERC-165 interface identifiers used to distinguish NFT standards. */
export const INTERFACE_ID = {
  erc721: '0x80ac58cd',
  erc1155: '0xd9b67a26',
} as const;
