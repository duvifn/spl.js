import { terser } from 'rollup-plugin-terser';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import json from '@rollup/plugin-json';
import copy from 'rollup-plugin-copy';

const ts = typescript({
    useTsconfigDeclarationDir: true
});

const cp = copy({
    targets: [
        { src: 'src/spl-web.d.ts', dest: 'dist', rename: 'index.d.ts' }
    ]
});

const cpWorker = copy({
    targets: [
        { src: 'src/build/js/worker.js', dest: 'dist' }
    ]
});

export default args => ({
    input: 'src/spl-web.ts',
    output: [
        { file: 'dist/index.js', format: 'es', preferConst: true, exports: 'auto'}
    ],
    plugins: args.configDebug ? [
        nodeResolve(),
        json(),
        ts,
        commonjs(),
        cp,
        cpWorker
    ] : [
        nodeResolve(),
        json(),
        ts,
        commonjs(),
        terser(),
        cp,
        cpWorker
    ]
});
