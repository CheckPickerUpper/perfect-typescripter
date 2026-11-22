'use strict';

/**
 * Groups values in their input order.
 * @param {object} parameters Values and the key read from each value.
 * @returns {Map} The values for each distinct key.
 * @example groupValuesByKey({ values: ['a', 'bb'], key: (value) => value.length });
 */
function groupValuesByKey({ values, key }) {
  const groups = new Map();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey);
    if (group) group.push(value);
    else groups.set(groupKey, [value]);
  }
  return groups;
}

module.exports = { groupValuesByKey };
