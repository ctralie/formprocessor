#!/bin/bash

pushd /home/wmongan/opt/formprocessor
source config.env
nohup node main.js &
