'use strict';

const gulp = require('gulp');
const $ = require('gulp-load-plugins')();
const tag = require('gulp-tag-version');
const spawn = require('child_process').spawn;

gulp.task('test', function (done) {
    gulp.src(['lib/**/*'])
        .pipe($.istanbul())
        .pipe($.istanbul.hookRequire())
        .on('finish', function () {
            gulp.src(['test/*.js'])
                .pipe($.mocha())
                .pipe($.istanbul.writeReports())
                .on('end', done);
        });
});

function inc (importance) {
    // get all the files to bump version in
    return gulp.src(['./package.json', './bower.json'])
    // bump the version number in those files
        .pipe($.bump({ type: importance }))

        // save it back to filesystem
        .pipe(gulp.dest('./'))

        // commit the changed version number
        .pipe($.git.commit('bumps package version'))

        // read only one file to get the version number
        .pipe($.filter('package.json'))

        // **tag it in the repository**
        .pipe(tag());
}

gulp.task('publish', function (done) {
    spawn('npm', ['publish'], { stdio: 'inherit' }).on('close', done);
});

gulp.task('patch', function () {
    return inc('patch');
});

gulp.task('feature', function () {
    return inc('minor');
});

gulp.task('major', function () {
    return inc('major');
});

/* Validate JavaScript files */
gulp.task('eslint', function () {
    return gulp.src(['{lib,test}/**/*.js'])
        .pipe($.eslint())
        .pipe($.eslint.format())
        .pipe($.eslint.failAfterError());
});

gulp.task('tag', function () {
    return gulp.src(['./package.json'])
    // save it back to filesystem
        .pipe(gulp.dest('./'))

        // commit the changed version number
        .pipe($.git.commit('bumps package version'))

        // read only one file to get the version number
        .pipe($.filter('package.json'))

        // **tag it in the repository**
        .pipe(tag());
});

gulp.task('push', function (done) {
    $.git.push('origin', 'master', { args: '--tags' }, done);
});

gulp.task('release', ['lint', 'test', 'patch']);

gulp.task('default', ['lint', 'test']);