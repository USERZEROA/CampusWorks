// Derived from deepmerge 4.3.1. See LICENSE for the upstream MIT notice.
// Prototype meta-properties are rejected in both inputs at every depth.
const blocked = new Set(['__proto__', 'constructor', 'prototype']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const enumerableKeys = object => Reflect.ownKeys(object).filter(key =>
  Object.prototype.propertyIsEnumerable.call(object, key) && !blocked.has(key));
const mergeable = value => !!value && typeof value === 'object' &&
  !(value instanceof Date) && !(value instanceof RegExp) &&
  value.$$typeof !== Symbol.for('react.element');

function clone(value, options) {
  return options.clone !== false && options.isMergeableObject(value)
    ? deepmerge(Array.isArray(value) ? [] : {}, value, options)
    : value;
}

function arrayMerge(target, source, options) {
  return target.concat(source).map(value => clone(value, options));
}

function set(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}

function deepmerge(target, source, supplied = {}) {
  const options = {
    ...supplied,
    arrayMerge: supplied.arrayMerge || arrayMerge,
    isMergeableObject: supplied.isMergeableObject || mergeable,
    cloneUnlessOtherwiseSpecified: clone,
  };
  const sourceArray = Array.isArray(source);
  if (sourceArray !== Array.isArray(target)) return clone(source, options);
  if (sourceArray) return options.arrayMerge(target, source, options);
  const result = {};
  if (options.isMergeableObject(target)) for (const key of enumerableKeys(target)) {
    set(result, key, clone(target[key], options));
  }
  if (source === null || source === undefined) return result;
  for (const key of enumerableKeys(Object(source))) {
    // Preserve the established protection against inherited/non-enumerable keys.
    if (key in Object(target) && (!own(Object(target), key) ||
      !Object.prototype.propertyIsEnumerable.call(target, key))) continue;
    if (own(Object(target), key) && options.isMergeableObject(source[key])) {
      const custom = options.customMerge?.(key);
      set(result, key, (typeof custom === 'function' ? custom : deepmerge)(target[key], source[key], options));
    } else set(result, key, clone(source[key], options));
  }
  return result;
}

deepmerge.all = function all(values, options) {
  if (!Array.isArray(values)) throw new TypeError('first argument should be an array');
  return values.reduce((result, value) => deepmerge(result, value, options), {});
};
module.exports = deepmerge;
