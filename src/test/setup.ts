/*
 * jsdom provides no IndexedDB, so tests run against `fake-indexeddb`, an
 * implementation of the real specification, including its transaction
 * semantics. That matters here: the sequence allocator's correctness rests on
 * IndexedDB serialising overlapping readwrite transactions, and a hand-rolled
 * mock would happily pretend that guarantee exists.
 */
import 'fake-indexeddb/auto'
