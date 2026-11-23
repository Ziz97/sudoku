# Sudoku

A Sudoku game that runs in the browser. It is plain HTML, CSS and JavaScript, with no build step.

**Play it here: https://ziz97.github.io/sudoku/**

## Features

- **Play mode**: new puzzles in four levels (Easy, Medium, Hard, Expert), each with exactly one solution. Mistakes are shown in red (you can turn this off), plus notes, undo, hints, a timer and pause.
- **Set up grid mode**: type in the clues of any grid, for example from a newspaper. Mistakes and conflicts are never shown while you set it up. When you start playing, the grid is checked for a solution.
- **Import from a picture** (in set up grid mode): choose, drop or paste a photo or screenshot of a grid. The grid is found and straightened (you can adjust its corners), and the numbers are read in the browser. Nothing is uploaded. Works with printed grids and screenshots, not handwriting.
- Progress is saved automatically in your browser (`localStorage`), so you can close the tab and come back later.
- Keyboard controls, light and dark themes, and a layout that works on phones.

## Run locally

Open `index.html` in a browser.

## Files

- `js/sudoku.js`: solver and puzzle generator
- `js/app.js`: game interface and saving
- `css/style.css`: styles
