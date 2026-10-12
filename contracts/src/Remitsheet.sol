// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Remitsheet
/// @notice Pays many recipients in a single transaction, either in the chain's native
///         currency (USDC on Arc) or in any ERC-20 token (for example EURC).
///
///         - No owner, no admin functions, no fees, no upgrades.
///         - Holds no funds: native value is forwarded within the same call and tokens move
///           directly from the sender to each recipient with transferFrom.
///         - All-or-nothing: if any single transfer fails, the whole batch reverts.
///
/// @dev    Every batch emits one {Paid} event per recipient line followed by one {BatchPaid}
///         event, so a receipt can be rebuilt from the transaction logs alone.
contract Remitsheet {
    /// @notice One recipient line of a batch.
    /// @param ref    Batch reference chosen by the sender (for example a payroll run or invoice id).
    /// @param token  Token paid, or address(0) for the native currency (USDC on Arc).
    /// @param to     Recipient.
    /// @param amount Amount in the asset's base units (18 decimals for native USDC on Arc,
    ///               6 decimals for the USDC and EURC ERC-20 contracts).
    event Paid(bytes32 indexed ref, address indexed token, address indexed to, uint256 amount);

    /// @notice Summary of a batch, emitted after all of its {Paid} lines.
    event BatchPaid(
        bytes32 indexed ref, address indexed sender, address indexed token, uint256 total, uint256 count
    );

    /// @notice The recipient list is empty.
    error EmptyBatch();
    /// @notice `to` and `amounts` have different lengths.
    error LengthMismatch(uint256 recipients, uint256 amounts);
    /// @notice Recipient at `index` is the zero address.
    error ZeroAddress(uint256 index);
    /// @notice Amount at `index` is zero.
    error ZeroAmount(uint256 index);
    /// @notice The sum of all amounts does not equal the native value sent.
    error ValueMismatch(uint256 total, uint256 value);
    /// @notice The transfer to the recipient at `index` failed (rejected, blocklisted,
    ///         insufficient balance or allowance, or a token that returned false).
    error TransferFailed(uint256 index, address to);
    /// @notice `token` is not a contract.
    error InvalidToken(address token);

    /// @notice Pays every recipient in the native currency. `msg.value` must equal the sum of `amounts`.
    /// @param to      Recipients.
    /// @param amounts Amounts in native base units (18 decimals on Arc), same order as `to`.
    /// @param ref     Batch reference recorded in the events.
    function payNative(address[] calldata to, uint256[] calldata amounts, bytes32 ref) external payable {
        uint256 n = _checkLengths(to.length, amounts.length);

        // First pass: validate every line and compute the total before any value moves,
        // so a wrong msg.value is reported as ValueMismatch rather than a failed transfer.
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (to[i] == address(0)) revert ZeroAddress(i);
            uint256 amount = amounts[i];
            if (amount == 0) revert ZeroAmount(i);
            total += amount; // checked arithmetic: an overflowing list reverts
        }
        if (total != msg.value) revert ValueMismatch(total, msg.value);

        // Second pass: transfer. All gas is forwarded so smart-contract wallets can receive,
        // and no return data is copied, so a recipient cannot grief the caller with a large return.
        for (uint256 i; i < n; ++i) {
            address recipient = to[i];
            uint256 amount = amounts[i];
            bool ok;
            assembly ("memory-safe") {
                ok := call(gas(), recipient, amount, 0, 0, 0, 0)
            }
            if (!ok) revert TransferFailed(i, recipient);
            emit Paid(ref, address(0), recipient, amount);
        }

        emit BatchPaid(ref, msg.sender, address(0), total, n);
    }

    /// @notice Pays every recipient in `token`, moving funds directly from the caller to each
    ///         recipient. The caller must first approve this contract for at least the total.
    /// @param token   ERC-20 token (for example EURC or the USDC ERC-20 interface on Arc).
    /// @param to      Recipients.
    /// @param amounts Amounts in the token's base units, same order as `to`.
    /// @param ref     Batch reference recorded in the events.
    function payToken(address token, address[] calldata to, uint256[] calldata amounts, bytes32 ref) external {
        if (token.code.length == 0) revert InvalidToken(token);
        uint256 n = _checkLengths(to.length, amounts.length);

        uint256 total;
        for (uint256 i; i < n; ++i) {
            address recipient = to[i];
            uint256 amount = amounts[i];
            if (recipient == address(0)) revert ZeroAddress(i);
            if (amount == 0) revert ZeroAmount(i);
            total += amount;
            if (!_transferFrom(token, msg.sender, recipient, amount)) revert TransferFailed(i, recipient);
            emit Paid(ref, token, recipient, amount);
        }

        emit BatchPaid(ref, msg.sender, token, total, n);
    }

    function _checkLengths(uint256 recipients, uint256 amounts) private pure returns (uint256) {
        if (recipients != amounts) revert LengthMismatch(recipients, amounts);
        if (recipients == 0) revert EmptyBatch();
        return recipients;
    }

    /// @dev Calls `token.transferFrom(from, to, amount)` and reports success. Accepts tokens that
    ///      return `true` and tokens that return nothing (the token's code was checked to exist);
    ///      anything else, including a revert or a `false` return, counts as failure.
    ///      Uses memory past the free memory pointer as scratch without moving the pointer, so the
    ///      memory cost stays constant however long the batch is.
    function _transferFrom(address token, address from, address to, uint256 amount) private returns (bool ok) {
        assembly ("memory-safe") {
            let p := mload(0x40)
            mstore(p, shl(224, 0x23b872dd)) // transferFrom(address,address,uint256)
            mstore(add(p, 0x04), from)
            mstore(add(p, 0x24), to)
            mstore(add(p, 0x44), amount)
            mstore(0x00, 0)
            ok := call(gas(), token, 0, p, 0x64, 0x00, 0x20)
            if ok {
                switch returndatasize()
                case 0 { ok := 1 }
                default { ok := and(gt(returndatasize(), 0x1f), eq(mload(0x00), 1)) }
            }
        }
    }
}
