/**
 * Monet.js 0.9.0-alpha.2
 *
 * (c) 2012-2016 Chris Myers
 * @license Monet.js may be freely distributed under the MIT license.
 * For all details and documentation:
 * https://cwmyers.github.com/monet.js
 */

/* global define */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(factory)
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory()
    } else {
        root.notUseMonetGlobalObject = !root.useMonetGlobalObject
        root.Monet = factory(root)
    }
}(this, function (rootGlobalObject) {
    'use strict'

    var root = {}

    var assign = (function (nativeAssign) {
        if (isFunction(nativeAssign)) {
            return nativeAssign
        }
        // yes exactly as native one - mutating target :(
        return function (target, source) { // we need only one level of composition
            for (var key in source) {
                // eslint-disable-next-line no-undefined
                if (source.hasOwnProperty(key) && source[key] !== undefined) {
                    target[key] = source[key]
                }
            }
            return target
        }
    }(Object.assign))

    var Monet = {
        apply2: apply2,
        assign: assign,
        compose: compose,
        curry: curry(swap(curry), [])([]),
        idFunction: idFunction,
        isFunction: isFunction,
        noop: noop,
        swap: swap
    }

    function isNothing(value) {
        return value == null // eslint-disable-line no-eq-null, eqeqeq
    }

    function noop() {} // eslint-disable-line no-empty-function

    function getArgs(args) {
        return Array.prototype.slice.call(args)
    }

    function curry(fn, args) {
        return function () {
            var args1 = args.concat(getArgs(arguments))
            return args1.length >= fn.length ?
                fn.apply(null, args1.slice(0, args1.length)) :
                curry(fn, args1)
        }
    }

    function compose(f, g) {
        return function (x) {
            return f(g(x))
        }
    }

    function isFunction(f) {
        return Boolean(f && f.constructor && f.call && f.apply)
    }

    function idFunction(value) {
        return value
    }

    function trueFunction() {
        return true
    }

    /* eslint-disable complexity */
    function areEqual(a, b) {
        // a !== a && b !== b is about NaN
        // eslint-disable-next-line no-self-compare
        if (a === b || a !== a && b !== b) {
            return true
        }
        // optimisation to avoid function checks
        if (!a || !b) {
            return false
        }
        if (isFunction(a.equals) && isFunction(b.equals)) {
            return a.equals(b)
        }
        return false
    }
    /* eslint-enable complexity */

    /* Curried equality check - useful for comparing monads */
    function equals(a) {
        return function (b) {
            return areEqual(a, b)
        }
    }

    function falseFunction() {
        return false
    }

    function swap(f) {
        return function (a, b) {
            return f(b, a)
        }
    }

    function apply2(a1, a2, f) {
        return a2.ap(a1.map(curry(f, [])))
    }

    // List and NEL monads commons

    function listEquals(list1, list2) {
        var a = list1
        var b = list2
        while (!a.isNil && !b.isNil) {
            if (!equals(a.head())(b.head())) {
                return false
            }
            a = a.tail()
            b = b.tail()
        }
        return a.isNil && b.isNil
    }

    function listMapC(fn, l) {
        return l.isNil ? Return(l) : Suspend(function () {
            return listMapC(fn, l.tail())
        }).map(curry(cons, [])(fn(l.head())))
    }

    function listMap(fn, l) {
        return listMapC(fn, l).run()
    }

    function listFilter(list, fn) {
        return list.foldRight(Nil)(function (a, acc) {
            return fn(a) ? cons(a, acc) : acc
        })
    }

    function listFindC(l, fn) {
        if (l.isNil) {
            return Return(None())
        }
        var h = l.head()
        return fn(h) ?
            Return(Some(h)) :
            Suspend(function () {
                return listFindC(l.tail(), fn)
            })
    }

    function listFind(l, fn) {
        return listFindC(l, fn).run()
    }

    function listContainsC(l, val) {
        if (l.isNil) {
            return Return(false)
        }
        var h = l.head()
        return areEqual(h, val) ?
            Return(true) :
            Suspend(function () {
                return listContainsC(l.tail(), val)
            })
    }

    function listContains(l, val) {
        return listContainsC(l, val).run()
    }

    function cons(head, tail) {
        return tail.cons(head)
    }

    // List monad
    function List() {
        switch (arguments.length) {
            case 0: return new List.fn.init()
            case 1: return new List.fn.init(arguments[0])
            default: return new List.fn.init(arguments[0], arguments[1])
        }
    }

    root.List = List

    var listForEach = function (effectFn, l) {
        if (!l.isNil) {
            effectFn(l.head())
            listForEach(effectFn, l.tail())
        }
    }

    var foldLeft = function (fn, acc, list) {

        function fL(innerAcc, innerList) {
            return innerList.isNil ?
                Return(innerAcc) :
                Suspend(function () {
                    return fL(fn(innerAcc, innerList.head()), innerList.tail())
                })
        }

        return fL(acc, list).run()
    }

    var foldRight = function (fn, list, acc) {
        function fR(innerList, innerAcc) {
            return innerList.isNil ?
                Return(innerAcc) :
                Suspend(function () {
                    return fR(innerList.tail(), innerAcc)
                }).map(function (accumulated) {
                    return fn(innerList.head(), accumulated)
                })
        }

        return fR(list, acc).run()
    }


    var append = function (self, other) {
        function appendFree(listA, listB) {
            return listA.isNil ?
                Return(listB) :
                Suspend(function () {
                    return appendFree(listA.tail(), listB)
                        .map(function (list) {
                            return list.cons(listA.head())
                        })
                })
        }

        return appendFree(self, other).run()
    }

    var sequence = function (list, type) {
        return list.foldRight(type.of(Nil))(type.map2(cons))
    }

    var sequenceValidation = function (list) {
        return list.foldLeft(Success(Nil))(function (acc, a) {
            return acc.ap(a.map(function (v) {
                return function (t) {
                    return cons(v, t)
                }
            }))
        }).map(listReverse)
    }

    var listReverse = function (list) {
        return list.foldLeft(Nil)(swap(cons))
    }

    var listAp = function (list1, list2) {
        return list1.bind(function (x) {
            return list2.map(function (f) {
                return f(x)
            })
        })
    }

    var Nil // eslint-disable-line init-declarations

    List.fn = List.prototype = {
        init: function () {
            var head = arguments[0]
            var tail = arguments[1]
            if (arguments.length === 0) {
                this.isNil = true
                this.size_ = 0
            } else {
                this.isNil = false
                this.head_ = head
                this.tail_ = tail || Nil
                this.size_ = this.tail_.size() + 1
            }
        },
        of: function (value) {
            return new List(value)
        },
        size: function () {
            return this.size_
        },
        equals: function (other) {
            return isFunction(other.head) && listEquals(this, other)
        },
        cons: function (head) {
            return List(head, this)
        },
        snoc: function (element) {
            return this.concat(List(element))
        },
        map: function (fn) {
            return listMap(fn, this)
        },
        toArray: function () {
            return foldLeft(function (acc, e) {
                acc.push(e)
                return acc
            }, [], this)
        },
        foldLeft: function (initialValue) {
            var self = this
            return function (fn) {
                return foldLeft(fn, initialValue, self)
            }
        },
        foldRight: function (initialValue) {
            var self = this
            return function (fn) {
                return foldRight(fn, self, initialValue)
            }
        },
        append: function (list2) {
            return append(this, list2)
        },
        filter: function (fn) {
            return listFilter(this, fn)
        },
        find: function(fn) {
            return listFind(this, fn)
        },
        flatten: function () {
            return foldRight(append, this, Nil)
        },
        flattenMaybe: function () {
            return this.flatMap(Maybe.toList)
        },
        reverse: function () {
            return listReverse(this)
        },
        bind: function (fn) {
            return this.map(fn).flatten()
        },
        forEach: function (effectFn) {
            listForEach(effectFn, this)
        },
        contains: function (val) {
            return listContains(this, val)
        },
        // transforms a list of Maybes to a Maybe list
        sequenceMaybe: function () {
            return sequence(this, Maybe)
        },
        sequenceValidation: function () {
            return sequenceValidation(this)
        },
        sequenceEither: function () {
            return sequence(this, Either)
        },
        sequenceIO: function () {
            return sequence(this, IO)
        },
        sequenceReader: function () {
            return sequence(this, Reader)
        },
        sequence: function (monadType) {
            return sequence(this, monadType)
        },
        head: function () {
            return this.head_
        },
        headMaybe: function () {
            return this.isNil ? None() : Some(this.head_)
        },
        tail: function () {
            return this.isNil ? Nil : this.tail_
        },
        tails: function () {
            return this.isNil ? List(Nil, Nil) : this.tail().tails().cons(this)
        },
        ap: function (list) {
            return listAp(this, list)
        },
        isNEL: falseFunction,
        toString: function () {
            return this.isNil ? 'Nil' : 'List(' + this.toArray().join(', ') + ')'
        },
        inspect: function () {
            return this.toString()
        }
    }

    List.fn.init.prototype = List.fn

    // Aliases

    List.prototype.empty = function () {
        return Nil
    }

    List.fromArray = function (array) {
        return array.reduceRight(function (acc, next) {
            return acc.cons(next)
        }, Nil)
    }

    List.of = function (a) {
        return new List(a, Nil)
    }

    // backwards compatibility, deprecated
    List.prototype.each = List.prototype.forEach

    Nil = root.Nil = new List.fn.init()

    /*
     * Non-Empty List monad
     * This is also a comonad because there exists the implementation of extract(copure), which is just head
     * and cobind and cojoin.
     *
     */

    function emptyNELError(head) {
        return new Error('Cannot create an empty Non-Empty List. Passed head is ' + head + '.')
    }

    function NEL(head, tail) {
        if (isNothing(head)) {
            throw emptyNELError(head)
        }
        return new NEL.fn.init(head, tail)
    }

    root.NEL = root.NonEmptyList = NEL

    NEL.of = function (a) {
        return NEL(a, Nil)
    }

    NEL.fn = NEL.prototype = {
        init: function (head, tail) {
            if (isNothing(head)) {
                throw emptyNELError(head)
            } else {
                this.isNil = false
                this.head_ = head
                this.tail_ = isNothing(tail) ? Nil : tail
                this.size_ = this.tail_.size() + 1
            }
        },
        equals: function (other) {
            if (!isFunction(other.head)) {
                return false
            }
            return listEquals(this, other)
        },
        map: function (fn) {
            return NEL(fn(this.head_), listMap(fn, this.tail_))
        },

        bind: function (fn) {
            var p = fn(this.head_)
            if (!p.isNEL()) {
                throw new Error('NEL.fn.bind: Passed function must return a NonEmptyList.')
            }
            var list = this.tail().foldLeft(Nil.snoc(p.head()).append(p.tail()))(function (acc, e) {
                var list2 = fn(e).toList()
                return acc.snoc(list2.head()).append(list2.tail())
            })

            return new NEL(list.head(), list.tail())
        },

        head: function () {
            return this.head_
        },

        tail: function () {
            return this.tail_
        },
        //NEL[A] -> NEL[NEL[A]]
        tails: function () {
            var listsOfNels = this.toList().tails().map(NEL.fromList).flattenMaybe()
            return NEL(listsOfNels.head(), listsOfNels.tail())
        },
        toList: function () {
            return List(this.head_, this.tail_)
        },
        reverse: function () {
            if (this.tail().isNil) {
                return this
            }
            var reversedTail = this.tail().reverse()
            return NEL(reversedTail.head(), reversedTail.tail().append(List(this.head())))
        },
        foldLeft: function (initialValue) {
            return this.toList().foldLeft(initialValue)
        },
        foldRight: function (initialValue) {
            return this.toList().foldRight(initialValue)
        },
        reduceLeft: function (fn) {
            return this.tail().foldLeft(this.head())(fn)
        },
        filter: function (fn) {
            return listFilter(this.toList(), fn)
        },
        find: function (fn) {
            return listFind(this.toList(), fn)
        },
        contains: function (val) {
            return listContains(this.toList(), val)
        },
        append: function (list2) {
            return NEL.fromList(this.toList().append(list2.toList())).some()
        },
        // NEL[A] -> (NEL[A] -> B) -> NEL[B]
        cobind: function (fn) {
            return this.cojoin().map(fn)
        },
        size: function () {
            return this.size_
        },
        forEach: function (fn) {
            return this.toList().forEach(fn)
        },
        isNEL: trueFunction,
        toString: function () {
            return 'NEL(' + this.toArray().join(', ') + ')'
        },
        inspect: function () {
            return this.toString()
        }
    }

    NEL.fromList = function (list) {
        return list.isNil ? None() : Some(NEL(list.head(), list.tail()))
    }

    NEL.fn.init.prototype = NEL.fn
    NEL.prototype.toArray = List.prototype.toArray
    NEL.prototype.extract = NEL.prototype.copure = NEL.prototype.head
    NEL.prototype.cojoin = NEL.prototype.tails
    NEL.prototype.coflatMap = NEL.prototype.mapTails = NEL.prototype.cobind
    NEL.prototype.ap = List.prototype.ap

    /* Maybe Monad */

    var Maybe = root.Maybe = {}

    Maybe.fromFalsy = function (val) {
        return !val ? Maybe.None() : Maybe.Some(val)
    }

    Maybe.fromNull = function (val) {
        return isNothing(val) ? Maybe.None() : Maybe.Some(val)
    }

    Maybe.of = function (a) {
        return Some(a)
    }

    var Some = Maybe.Just = Maybe.Some = Maybe.some = root.Some = root.Just = function (val) {
        return new Maybe.fn.init(true, val)
    }

    var None = Maybe.Nothing = Maybe.None = Maybe.none = root.None = root.Nothing = function () {
        return new Maybe.fn.init(false, null)
    }

    Maybe.toList = function (maybe) {
        return maybe.toList()
    }

    Maybe.fn = Maybe.prototype = {
        init: function (isValue, val) {
            this.isValue = isValue
            if (isValue && isNothing(val)) {
                throw new Error('Can not create Some with illegal value: ' + val + '.')
            }
            this.val = val
        },
        isSome: function () {
            return this.isValue
        },
        isNone: function () {
            return !this.isSome()
        },
        bind: function (bindFn) {
            return this.isValue ? bindFn(this.val) : this
        },
        some: function () {
            if (this.isValue) {
                return this.val
            }
            throw new Error('Cannot call .some() on a None.')
        },
        orSome: function (otherValue) {
            return this.isValue ? this.val : otherValue
        },
        orNull: function () {
            return this.isValue ? this.val : null
        },
        orElse: function (maybe) {
            return this.isValue ? this : maybe
        },
        ap: function (maybeWithFunction) {
            var value = this.val
            return this.isValue ? maybeWithFunction.map(function (fn) {
                return fn(value)
            }) : this
        },
        equals: function (other) {
            return isFunction(other.isNone) &&
                isFunction(other.map) &&
                this.cata(function () {
                    return other.isNone()
                }, function (val) {
                    return other.fold(false)(equals(val))
                })
        },
        toList: function () {
            return this.map(List).orSome(Nil)
        },
        toEither: function (failVal) {
            return this.isSome() ? Right(this.val) : Left(failVal)
        },
        toValidation: function (failVal) {
            return this.isSome() ? Success(this.val) : Fail(failVal)
        },
        fold: function (defaultValue) {
            var self = this
            return function (fn) {
                return self.isSome() ? fn(self.val) : defaultValue
            }
        },
        foldLeft: function (initialValue) {
            return this.toList().foldLeft(initialValue)
        },
        foldRight: function (initialValue) {
            return this.toList().foldRight(initialValue)
        },
        cata: function (none, some) {
            return this.isSome() ? some(this.val) : none()
        },
        filter: function (fn) {
            var self = this
            return self.flatMap(function (a) {
                return fn(a) ? self : None()
            })
        },
        orNoneIf: function (bool) {
            return bool ? None() : this
        },
        contains: function (val) {
            return this.isSome() ? areEqual(this.val, val) : false
        },
        forEach: function (fn) {
            this.cata(noop, fn)
        },
        orElseRun: function (fn) {
            this.cata(fn, noop)
        },
        toString: function() {
            return this.isSome() ? 'Just(' + this.val + ')' : 'Nothing'
        },
        inspect: function() {
            return this.toString()
        }
    }

    // aliases
    Maybe.prototype.orJust = Maybe.prototype.orSome
    Maybe.prototype.just = Maybe.prototype.some
    Maybe.prototype.isJust = Maybe.prototype.isSome
    Maybe.prototype.isNothing = Maybe.prototype.isNone
    Maybe.prototype.orNothingIf = Maybe.prototype.orNoneIf

    Maybe.fn.init.prototype = Maybe.fn

    var Validation = root.Validation = {}

    var Success = Validation.Success = Validation.success = root.Success = function (val) {
        return new Validation.fn.init(val, true)
    }

    var Fail = Validation.Fail = Validation.fail = root.Fail = function (error) {
        return new Validation.fn.init(error, false)
    }

    Validation.of = function (v) {
        return Success(v)
    }

    Validation.fn = Validation.prototype = {
        init: function (val, success) {
            this.val = val
            this.isSuccessValue = success
        },
        success: function () {
            if (this.isSuccess()) {
                return this.val
            }
            throw new Error('Cannot call success() on a Fail.')
        },
        isSuccess: function () {
            return this.isSuccessValue
        },
        isFail: function () {
            return !this.isSuccessValue
        },
        fail: function () {
            if (this.isSuccess()) {
                throw new Error('Cannot call fail() on a Success.')
            }
            return this.val
        },
        bind: function (fn) {
            return this.isSuccess() ? fn(this.val) : this
        },
        ap: function (validationWithFn) {
            var value = this.val
            return this.isSuccess() ?
                validationWithFn.map(function (fn) {
                    return fn(value)
                }) :
                validationWithFn.isFail() ?
                    Validation.Fail(Semigroup.append(value, validationWithFn.fail()))
                    : this
        },
        acc: function () {
            var x = function () {
                return x
            }
            return this.isSuccessValue ? Validation.success(x) : this
        },
        foldLeft: function (initialValue) {
            return this.toMaybe().toList().foldLeft(initialValue)
        },
        foldRight: function (initialValue) {
            return this.toMaybe().toList().foldRight(initialValue)
        },
        cata: function (fail, success) {
            return this.isSuccessValue ?
                success(this.val)
                : fail(this.val)
        },
        failMap: function (fn) {
            return this.isFail() ? Fail(fn(this.val)) : this
        },
        bimap: function (fail, success) {
            return this.isSuccessValue ? this.map(success) : this.failMap(fail)
        },
        forEach: function (fn) {
            this.cata(noop, fn)
        },
        forEachFail: function (fn) {
            this.cata(fn, noop)
        },
        equals: function (other) {
            return this.cata(
                function (fail) {
                    return other.cata(equals(fail), falseFunction)
                },
                function (success) {
                    return other.cata(falseFunction, equals(success))
                }
            )
        },
        contains: function (val) {
            return this.isSuccessValue ? areEqual(this.val, val) : false
        },
        toMaybe: function () {
            return this.isSuccess() ? Some(this.val) : None()
        },
        toEither: function () {
            return (this.isSuccess() ? Right : Left)(this.val)
        },
        toString: function () {
            return (this.isSuccess() ? 'Success(' : 'Fail(') + this.val + ')'
        },
        inspect: function () {
            return this.toString()
        }
    }

    // aliases
    Validation.prototype.fold = Validation.prototype.cata

    Validation.fn.init.prototype = Validation.fn

    var Semigroup = root.Semigroup = {
        append: function (a, b) {
            if (isFunction(a.concat)) {
                return a.concat(b)
            }
            throw new Error(
                'Couldn\'t find a semigroup appender in the environment, ' +
                'please specify your own append function')
        }
    }

    var MonadT = root.monadTransformer = root.MonadT = root.monadT = function (monad) {
        return new MonadT.fn.init(monad)
    }

    MonadT.of = function (m) {
        return MonadT(m)
    }

    MonadT.fn = MonadT.prototype = {
        init: function (monad) {
            this.monad = monad
        },
        map: function (fn) {
            return MonadT(this.monad.map(function (v) {
                return v.map(fn)
            }))
        },
        bind: function (fn) {
            return MonadT(this.monad.map(function (v) {
                return v.flatMap(fn)
            }))
        },
        ap: function (monadWithFn) {
            return MonadT(this.monad.flatMap(function (v) {
                return monadWithFn.perform().map(function (v2) {
                    return v.ap(v2)
                })
            }))
        },
        perform: function () {
            return this.monad
        }
    }

    MonadT.fn.init.prototype = MonadT.fn

    var IO = root.IO = root.io = function (effectFn) {
        return new IO.fn.init(effectFn)
    }

    IO.of = function (a) {
        return IO(function () {
            return a
        })
    }

    IO.fn = IO.prototype = {
        init: function (effectFn) {
            if (!isFunction(effectFn)) {
                throw new Error('IO requires a function.')
            }
            this.effectFn = effectFn
        },
        map: function (fn) {
            var self = this
            return IO(function () {
                return fn(self.effectFn())
            })
        },
        bind: function (fn) {
            var self = this
            return IO(function () {
                return fn(self.effectFn()).run()
            })
        },
        ap: function (ioWithFn) {
            var self = this
            return ioWithFn.map(function (fn) {
                return fn(self.effectFn())
            })
        },
        run: function () {
            return this.effectFn()
        }
    }

    IO.fn.init.prototype = IO.fn

    IO.prototype.perform = IO.prototype.performUnsafeIO = IO.prototype.run

    /* Either Monad */

    var Either = root.Either = {}

    Either.of = function (a) {
        return Right(a)
    }

    var Right = Either.Right = Either.right = root.Right = function (val) {
        return new Either.fn.init(val, true)
    }
    var Left = Either.Left = Either.left = root.Left = function (val) {
        return new Either.fn.init(val, false)
    }

    Either.fn = Either.prototype = {
        init: function (val, isRightValue) {
            this.isRightValue = isRightValue
            this.value = val
        },
        bind: function (fn) {
            return this.isRightValue ? fn(this.value) : this
        },
        ap: function (eitherWithFn) {
            var self = this
            return this.isRightValue ? eitherWithFn.map(function (fn) {
                return fn(self.value)
            }) : this
        },
        leftMap: function (fn) {
            return this.isLeft() ? Left(fn(this.value)) : this
        },
        isRight: function () {
            return this.isRightValue
        },
        isLeft: function () {
            return !this.isRight()
        },
        right: function () {
            if (this.isRightValue) {
                return this.value
            }
            throw new Error('Cannot call right() on a Left.')
        },
        left: function () {
            if (this.isRightValue) {
                throw new Error('Cannot call left() on a Right.')
            }
            return this.value
        },
        foldLeft: function (initialValue) {
            return this.toMaybe().toList().foldLeft(initialValue)
        },
        foldRight: function (initialValue) {
            return this.toMaybe().toList().foldRight(initialValue)
        },
        cata: function (leftFn, rightFn) {
            return this.isRightValue ? rightFn(this.value) : leftFn(this.value)
        },
        forEach: function (fn) {
            this.cata(noop, fn)
        },
        forEachLeft: function (fn) {
            this.cata(fn, noop)
        },
        equals: function (other) {
            if (!isFunction(other.isRight) || !isFunction(other.cata)) {
                return false
            }
            return this.cata(
                function (left) {
                    return other.cata(equals(left), falseFunction)
                },
                function (right) {
                    return other.cata(falseFunction, equals(right))
                }
            )
        },
        contains: function (val) {
            return this.isRight() ? areEqual(this.value, val) : false
        },
        bimap: function (leftFn, rightFn) {
            return this.isRightValue ? this.map(rightFn) : this.leftMap(leftFn)
        },
        toMaybe: function () {
            return this.isRight() ? Some(this.value) : None()
        },
        toValidation: function () {
            return this.isRight() ? Success(this.value) : Fail(this.value)
        },
        toString: function () {
            return this.cata(
                function(left) { return 'Left(' + left + ')' },
                function(right) { return 'Right(' + right + ')' }
            )
        },
        inspect: function() {
            return this.toString()
        }
    }

    // aliases
    Either.prototype.fold = Either.prototype.cata

    Either.fn.init.prototype = Either.fn

    var Reader = root.Reader = function (fn) {
        return new Reader.fn.init(fn)
    }

    Reader.of = function (x) {
        // eslint-disable-next-line no-unused-vars
        return Reader(function (_ /* do not remove - it's for currying purposes */) {
            return x
        })
    }

    Reader.ask = function () {
        return Reader(idFunction)
    }

    Reader.fn = Reader.prototype = {
        init: function (fn) {
            this.f = fn
        },
        run: function (config) {
            return this.f(config)
        },
        bind: function (fn) {
            var self = this
            return Reader(function (config) {
                return fn(self.run(config)).run(config)
            })
        },
        ap: function (readerWithFn) {
            var self = this
            return readerWithFn.bind(function (fn) {
                return Reader(function (config) {
                    return fn(self.run(config))
                })
            })
        },
        map: function (fn) {
            var self = this
            return Reader(function (config) {
                return fn(self.run(config))
            })
        },
        local: function (fn) {
            var self = this
            return Reader(function (c) {
                return self.run(fn(c))
            })
        }
    }

    Reader.fn.init.prototype = Reader.fn

    var Free = root.Free = {}

    var Suspend = Free.Suspend = root.Suspend = function (functor) {
        return new Free.fn.init(functor, true)
    }
    var Return = Free.Return = root.Return = function (val) {
        return new Free.fn.init(val, false)
    }

    Free.of = function (a) {
        return Return(a)
    }

    Free.liftF = function (functor) {
        return isFunction(functor) ?
            Suspend(compose(Return, functor)) :
            Suspend(functor.map(Return))
    }

    Free.fn = Free.prototype = {
        init: function (val, isSuspend) {
            this.isSuspend = isSuspend
            if (isSuspend) {
                this.functor = val
            } else {
                this.val = val
            }
        },
        run: function () {
            return this.go(function (f) {
                return f()
            })
        },
        bind: function (fn) {

            return this.isSuspend ?

                isFunction(this.functor) ?

                    Suspend(compose(function (free) {
                        return free.bind(fn)
                    }, this.functor)) :

                    Suspend(this.functor.map(function (free) {
                        return free.bind(fn)
                    })) :

                fn(this.val)
        },
        ap: function (ff) {
            return this.bind(function (x) {
                return ff.map(function (f) {
                    return f(x)
                })
            })
        },

        resume: function () {
            return this.isSuspend ? Left(this.functor) : Right(this.val)
        },

        go1: function (f) {
            function go2(t) {
                return t.resume().cata(function (functor) {
                    return go2(f(functor))
                }, idFunction)
            }

            return go2(this)
        },
        go: function (f) {
            var result = this.resume()
            while (result.isLeft()) {
                var next = f(result.left())
                result = next.resume()
            }

            return result.right()
        }

    }

    Free.fn.init.prototype = Free.fn

    function Identity(a) {
        return new Identity.fn.init(a)
    }

    root.Identity = Identity

    Identity.of = function (a) {
        return new Identity(a)
    }

    Identity.fn = Identity.prototype = {
        init: function (val) {
            this.val = val
        },
        bind: function (fn) {
            return fn(this.val)
        },
        get: function () {
            return this.val
        },
        forEach: function (fn) {
            fn(this.val)
        },
        equals: function (other) {
            return isFunction(other.get) && equals(this.get())(other.get())
        },
        contains: function (val) {
            return areEqual(this.val, val)
        },
        toString: function () {
            return 'Identity(' + this.val + ')'
        },
        inspect: function () {
            return this.toString()
        },
        ap: function (applyWithFunction) {
            var value = this.val
            return applyWithFunction.map(function (fn) {
                return fn(value)
            })
        }
    }

    Identity.fn.init.prototype = Identity.fn

    // Add aliases

    function addFantasyLandAliases(type) {
        ['ap', 'equals']
            .filter(function (method) {
                return isFunction(type.prototype[method])
            })
            .forEach(function (method) {
                type.prototype['fantasy-land/' + method] = type.prototype[method]
            })
    }

    function addAliases(type) {
        type.prototype.flatMap = type.prototype.chain = type.prototype.bind
        type.pure = type.unit = type.of
        type.prototype.of = type.of
        if (isFunction(type.prototype.append)) {
            type.prototype.concat = type.prototype.append
        }
        type.prototype.point = type.prototype.pure = type.prototype.unit = type.prototype.of
    }

    // Wire up aliases
    function addMonadOps(type) {
        type.prototype.join = function () {
            return this.flatMap(idFunction)
        }

        type.map2 = function (fn) {
            return function (ma, mb) {
                return ma.flatMap(function (a) {
                    return mb.map(function (b) {
                        return fn(a, b)
                    })
                })
            }
        }
    }

    function addFunctorOps(type) {
        if (!isFunction(type.prototype.map)) {
            type.prototype.map = function (fn) {
                return this.bind(compose(this.of, fn))
            }
        }
    }

    function addApplicativeOps(type) {
        type.prototype.takeLeft = function (m) {
            // eslint-disable-next-line no-unused-vars
            return apply2(this, m, function (a, b  /* do not remove `b` - it's for currying purposes */) {
                return a
            })
        }

        type.prototype.takeRight = function (m) {
            return apply2(this, m, function (a, b) {
                return b
            })
        }
    }

    function decorate(type) {
        addAliases(type)
        addMonadOps(type)
        addFunctorOps(type)
        addApplicativeOps(type)
        addFantasyLandAliases(type)
    }

    decorate(MonadT)
    decorate(Either)
    decorate(Maybe)
    decorate(IO)
    decorate(NEL)
    decorate(List)
    decorate(Validation)
    decorate(Reader)
    decorate(Free)
    decorate(Identity)

    return Maybe.fromNull(rootGlobalObject)
        .filter(function (rootObj) { return Boolean(rootObj.notUseMonetGlobalObject) })
        .cata(function () { return assign(Monet, root) }, function (rootObj) {
            assign(rootObj, root)
            return Monet
        })
}))
