pragma solidity ^0.4.15;

import "../lib/dappsys/auth.sol";
import "../lib/dappsys/math.sol";
import "./ERC20Extended.sol";


contract Colony is DSAuth, DSMath {
  address resolver;
  ERC20Extended public token;
  // This property, exactly as defined, is used in build scripts. Take care when updating.
  // Version number should be upped with every change in Colony or its dependency contracts or libraries.
  uint256 public version = 4;
  bytes32 public name;

  struct Task {
    string name;
    string description;
    bool accepted;
    uint eth;
    uint tokens;
    uint reservedTokens;
    bool funded;
  }
  mapping (uint => Task) public tasks;
  uint public taskCount;
  uint public reservedTokens;

  modifier throwIfIsEmptyString(string _id) {
    require(bytes(_id).length != 0);
    _;
  }

  modifier tasksExists(uint256 _id) {
    require(_id <= taskCount);
    _;
  }

  modifier tasksNotAccepted(uint256 _id) {
    require(!tasks[_id].accepted);
    _;
  }

  modifier taskAccepted(uint256 _id) {
    require(tasks[_id].accepted);
    _;
  }

  function Colony(bytes32 _name, address _token)
  payable
  {
    name = _name;
    token = ERC20Extended(_token);
  }

  function getTask(uint256 _id)
  constant returns (string, string, bool, uint, uint, uint, bool)
  {
    Task storage task = tasks[_id];
    return (task.name,
      task.description,
      task.accepted,
      task.eth,
      task.tokens,
      task.reservedTokens,
      task.funded);
  }

  function makeTask(string _name, string _summary)
  auth
  throwIfIsEmptyString(_name)
  {
    taskCount += 1;
    tasks[taskCount] = Task(_name, _summary, false, 0, 0, 0, false);
  }

  function updateTaskTitle(uint256 _id, string _name)
  auth
  throwIfIsEmptyString(_name)
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    tasks[_id].name = _name;
  }

  function updateTaskSummary(uint256 _id, string _summary)
  auth
  throwIfIsEmptyString(_summary)
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    tasks[_id].description = _summary;
  }

  function acceptTask(uint256 _id)
  auth
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    tasks[_id].accepted = true;
  }

  function contributeEthToTask(uint256 _id)
  auth
  payable
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    Task storage task = tasks[_id];
    task.eth = add(task.eth, msg.value);
    task.funded = true;
  }

  function contributeTokensToTask(uint256 _id, uint256 _amount)
  auth
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    Task storage task = tasks[_id];
    task.tokens = add(task.tokens, _amount);
    task.funded = true;
  }

  function setReservedTokensForTask(uint256 _id, uint256 _amount)
  auth
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    Task storage task = tasks[_id];
    // Ensure colony has sufficient tokens
    var colonyTokenBalance = token.balanceOf(this);
    var availableColonyTokens = add(sub(colonyTokenBalance, reservedTokens), task.reservedTokens);
    require(availableColonyTokens >= _amount);

    reservedTokens = add(sub(reservedTokens, task.reservedTokens), _amount);
    task.tokens = add(sub(task.tokens, task.reservedTokens), _amount);
    task.reservedTokens = _amount;
    task.funded = true;
  }

  function removeReservedTokensForTask(uint256 _id)
  auth
  tasksExists(_id)
  taskAccepted(_id)
  {
    Task storage task = tasks[_id];
    // Intentioanlly not removing the `task_tokensWei` value because of tracking history for tasks
    reservedTokens = sub(reservedTokens, task.reservedTokens);
    task.reservedTokens = 0;
  }

  /// @notice mark a task as completed, pay the user who completed it and root colony fee
  /// @param _id the task ID to be completed and paid
  /// @param _assignee the address of the user to be paid
  function completeAndPayTask(uint256 _id, address _assignee)
  auth
  tasksExists(_id)
  tasksNotAccepted(_id)
  {
    Task storage task = tasks[_id];
    require(token.balanceOf(this) >= task.tokens);
    acceptTask(_id);

    if (task.eth > 0) {
      _assignee.transfer(task.eth);
    }

    uint256 tokens = task.tokens;
    if (tokens > 0) {
      token.transfer(_assignee, tokens);
      removeReservedTokensForTask(_id);
    }
  }

  function mintTokens(uint128 _wad)
  auth
  {
    return token.mint(_wad);
  }

  // Upgrade the colony migrating its data adn funds to another colony instance
  function upgrade(address newColonyAddress_)
  auth
  {
    var tokensBalance = token.balanceOf(this);
    assert(tokensBalance > 0 && !token.transfer(newColonyAddress_, tokensBalance));
    selfdestruct(newColonyAddress_);
  }

  function ()
  payable
  {
      // Contracts that want to receive Ether with a plain "send" have to implement
      // a fallback function with the payable modifier. Contracts now throw if no payable
      // fallback function is defined and no function matches the signature.
  }
}
