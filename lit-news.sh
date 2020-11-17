#!/bin/bash
###
 # @Author: vhxubo
 # @Date: 2020-11-17 21:16:38
 # @LastEditTime: 2020-11-17 21:23:43
 # @LastEditors: vhxubo
 # @Description: 洛阳理工学院首页新闻提取
### 

git=https://github.com/vhxubo/scripts
version=1.0.0

echo -e "Welcome to lit-news-sh($version)!\nGitHub: $git\n"
echo `curl -s https://www.lit.edu.cn | grep -P -o "href=\"info\/\d{4}\/\d{5}\.htm\" title=\"[\p{Han}\d\w\W]*\""` > litnews.txt
sed -i 's/target="_blank"/\n/g' litnews.txt
sed -i 's/href=\"\(.*\)\" title=\"\(.*\)\"/www\.lit\.edu\.cn\/\1\t\2 /g' litnews.txt
sed -i 's/ //g' litnews.txt
sort -r litnews.txt
rm litnews.txt